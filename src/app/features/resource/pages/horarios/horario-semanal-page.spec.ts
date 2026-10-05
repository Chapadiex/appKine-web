import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { HorarioSemanalPage } from './horario-semanal-page';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import {
  RUTA_PERMISOS_EFECTIVOS,
  rutaBloquesDisponibilidad,
  rutaMemberships,
} from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const ORG = 1;
const SEDE = 3;
const PROFESIONAL = 42;

const BLOQUES = rutaBloquesDisponibilidad(SEDE, PROFESIONAL);

/** Profesional con vinculo de alcance organizacion: habilita en TODAS las sedes, incluida esta. */
const ANA = {
  id: PROFESIONAL,
  accountName: 'Ana Kine',
  accountEmail: 'ana@example.test',
  roleCode: 'PROFESIONAL',
  estado: 'ACTIVA',
  consultorioId: null,
};

/** No es profesional: no se le carga horario de atencion. No tiene que aparecer en el selector. */
const RECEPCION = {
  id: 43,
  accountName: 'Recepcion',
  accountEmail: 'recepcion@example.test',
  roleCode: 'ADMINISTRATIVO',
  estado: 'ACTIVA',
  consultorioId: SEDE,
};

/** Profesional acotado a OTRA sede: el backend responderia 409 profesional-no-vinculado. */
const OTRA_SEDE = {
  id: 44,
  accountName: 'Beto Fisio',
  accountEmail: 'beto@example.test',
  roleCode: 'PROFESIONAL',
  estado: 'ACTIVA',
  consultorioId: 99,
};

/** Manana del lunes. Es el bloque contra el que choca el 409 del spec. */
const LUNES_MANANA = {
  id: 100,
  consultorioId: SEDE,
  membershipId: PROFESIONAL,
  diaSemana: 1,
  horaDesde: '09:00',
  horaHasta: '12:00',
  vigenciaDesde: '2026-01-05',
  estado: 'ACTIVO',
  version: 1,
  turnosAfectados: 0,
};

/**
 * Tarde del lunes, que <b>empieza donde termina la manana</b>.
 *
 * <p>Es el horario mas comun que existe y NO es un solapamiento: la hora de fin es exclusiva.
 * Si la pantalla lo tratara como conflicto, el error se veria en todos los centros reales.
 */
const LUNES_TARDE = {
  id: 101,
  consultorioId: SEDE,
  membershipId: PROFESIONAL,
  diaSemana: 1,
  horaDesde: '12:00',
  horaHasta: '15:00',
  vigenciaDesde: '2026-01-05',
  estado: 'ACTIVO',
  version: 1,
  turnosAfectados: 0,
};

/** El caso limite del contrato: llega hasta el final del dia, y eso se escribe `24:00`. */
const MARTES_NOCHE = {
  id: 102,
  consultorioId: SEDE,
  membershipId: PROFESIONAL,
  diaSemana: 2,
  horaDesde: '20:00',
  horaHasta: '24:00',
  vigenciaDesde: '2026-01-05',
  vigenciaHasta: null,
  estado: 'ACTIVO',
  version: 4,
  turnosAfectados: 0,
};

const HORARIO = [LUNES_MANANA, LUNES_TARDE, MARTES_NOCHE];

/**
 * Spec del horario semanal del profesional (M05, AKINE-02.04).
 *
 * <p>Cubre lo que, si se rompe, <b>no produce ningun error visible</b>:
 *
 * <ol>
 *   <li>Que dos bloques contiguos convivan. Un formulario que los rechace no falla: rechaza
 *       silenciosamente el horario mas comun que hay.</li>
 *   <li>Que la medianoche siga siendo el string `24:00` al mostrarla y al mandarla. Parseada a
 *       `Date` vuelve como `00:00` y el bloque pasa a durar cero minutos, con `200` del
 *       backend.</li>
 *   <li>Que el `409` de solapamiento senale <b>los dos</b> bloques. Un toast generico deja al
 *       administrador comparando horas a ojo, y la operacion parece rota sin estarlo.</li>
 * </ol>
 */
describe('HorarioSemanalPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  /** La query string con la que se abre la pantalla. Se lee al crear el componente. */
  let queryParams: Record<string, string> = {};

  beforeEach(async () => {
    queryParams = {};

    await TestBed.configureTestingModule({
      imports: [HorarioSemanalPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              get queryParamMap() {
                return convertToParamMap(queryParams);
              },
            },
          },
        },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
    permisos = TestBed.inject(PermissionsStore);
  });

  afterEach(() => httpMock.verify());

  it('la semana muestra los siete dias y dos bloques contiguos conviven sin conflicto', async () => {
    const fixture = await montar();
    const contenido = texto(fixture);

    // Los siete, siempre. Saltear un dia sin bloques correria la grilla y el lector veria el
    // horario del jueves creyendo que es el del miercoles.
    expect(fixture.nativeElement.querySelectorAll('.dia').length).toBe(7);
    expect(contenido).toContain('Miercoles');
    expect(contenido).toContain('No atiende');

    // Manana y tarde del lunes, las dos presentes y ninguna marcada como conflicto.
    expect(contenido).toContain('09:00 a 12:00');
    expect(contenido).toContain('12:00 a 15:00');
    expect(fixture.nativeElement.querySelectorAll('.bloque--conflicto').length).toBe(0);
    expect(contenido).not.toContain('Este es el bloque con el que se pisa');

    // El selector ofrece solo a quien puede tener horario en ESTA sede: ni la administrativa ni
    // el profesional acotado a la sede 99, cuyo alta terminaria siempre en 409.
    const opciones = [...fixture.nativeElement.querySelectorAll('#selector-profesional option')];
    expect(opciones.map((opcion) => (opcion as HTMLOptionElement).textContent?.trim())).toEqual([
      'Sin elegir',
      'Ana Kine',
    ]);
  });

  it('un bloque hasta la medianoche se muestra como 24:00 y se reenvia como 24:00', async () => {
    const fixture = await montar();

    // Se muestra el string del contrato, con su traduccion en palabras al lado: "24:00" a secas
    // se lee como un error de carga.
    expect(texto(fixture)).toContain('20:00 a medianoche (24:00)');

    // Y se puede volver a escribir: el campo es de texto justamente porque un `type="time"`
    // rechaza 24:00 y vacia el control sin decir nada.
    abrir(fixture, 'Agregar un bloque');
    escribir(fixture, '#alta-bloque-desde', '20:00');
    escribir(fixture, '#alta-bloque-hasta', '24:00');
    seleccionar(fixture, '#alta-bloque-dia', '3');
    enviar(fixture, 'form');

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === BLOQUES,
    );
    expect(alta.request.body).toEqual({ diaSemana: 3, horaDesde: '20:00', horaHasta: '24:00' });

    alta.flush({ ...MARTES_NOCHE, id: 103, diaSemana: 3 }, { status: 201, statusText: 'Created' });
    httpMock.expectOne(BLOQUES).flush(HORARIO);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('quedo cargado en el horario semanal');
  });

  it('un 409 de solapamiento muestra los dos bloques que chocan, no un cartel generico', async () => {
    const fixture = await montar();

    abrir(fixture, 'Agregar un bloque');
    escribir(fixture, '#alta-bloque-desde', '10:00');
    escribir(fixture, '#alta-bloque-hasta', '11:00');
    enviar(fixture, 'form');

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'POST')
      .flush(
        {
          type: 'https://akine.app/problems/bloque-solapado',
          bloqueEnConflictoId: LUNES_MANANA.id,
          diaSemana: 1,
          horaDesde: '09:00',
          horaHasta: '12:00',
        },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);

    const contenido = texto(fixture);

    // 1. El mensaje NOMBRA el otro bloque: sin esto hay que recorrer la semana comparando horas.
    expect(contenido).toContain('se pisa con el bloque del lunes de 09:00 a 12:00');
    // 2. Y aclara lo que el usuario esta por "corregir" mal: contiguo no es solapado.
    expect(contenido).toContain('la manana de 09:00 a 12:00 y la tarde de 12:00 a 15:00 conviven');

    // 3. La fila del bloque en conflicto queda senalada, y SOLO esa. El color no es lo unico
    //    que la distingue: dentro de la fila hay un texto que lo dice.
    const marcados = [...fixture.nativeElement.querySelectorAll('.bloque--conflicto')];
    expect(marcados.length).toBe(1);
    expect(marcados[0].textContent).toContain('09:00 a 12:00');
    expect(marcados[0].textContent).toContain('Este es el bloque con el que se pisa');

    // 4. El panel sigue abierto con lo escrito: la correccion es sobre eso mismo.
    expect(campo(fixture, '#alta-bloque-desde')).toBe('10:00');
  });

  it('la baja pide motivo antes de enviar nada a la red', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de baja');

    // La irreversibilidad se dice ANTES de confirmar: el contrato no publica reactivacion.
    expect(texto(fixture)).toContain('no se puede deshacer');

    // Sin motivo NO sale a la red. El backend lo exige igual, y gastar un rechazo del servidor
    // para decir algo que ya se sabe deja al usuario esperando un viaje de ida y vuelta.
    enviar(fixture, 'akine-confirmacion-con-motivo form');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'DELETE');
    expect(texto(fixture)).toContain('El motivo es obligatorio');

    escribir(fixture, '#baja-bloque-reason', 'Dejo de atender los lunes a la manana');
    enviar(fixture, 'akine-confirmacion-con-motivo form');

    const baja = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'DELETE',
    );
    expect(baja.request.url).toBe(`${BLOQUES}/${LUNES_MANANA.id}`);
    expect(baja.request.body).toEqual({ reason: 'Dejo de atender los lunes a la manana' });

    baja.flush({ ...LUNES_MANANA, estado: 'INACTIVO' });
    httpMock.expectOne(BLOQUES).flush([LUNES_TARDE, MARTES_NOCHE]);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('sobrevive con su motivo');
  });

  it('la edicion manda solo lo que cambio, y siempre la version', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');

    // El formulario carga las horas TAL CUAL llegaron, sin reformatear.
    expect(campo(fixture, '#editar-bloque-desde')).toBe('09:00');

    seleccionar(fixture, '#editar-bloque-dia', '4');
    enviar(fixture, 'form');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'PUT',
    );

    // Solo el dia y la version. Las horas y la vigencia no viajan: omitido significa "no lo
    // toques", y reenviarlas pisaria lo que otro haya cambiado en el medio.
    expect(edicion.request.body).toEqual({ version: 1, diaSemana: 4 });

    edicion.flush({ ...LUNES_MANANA, diaSemana: 4, version: 2 });
    httpMock.expectOne(BLOQUES).flush(HORARIO);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('quedaron guardados');
  });

  it('un rango invertido no sale a la red, y volver a "Sin elegir" vacia la semana', async () => {
    const fixture = await montar();

    abrir(fixture, 'Agregar un bloque');
    escribir(fixture, '#alta-bloque-desde', '15:00');
    escribir(fixture, '#alta-bloque-hasta', '09:00');
    enviar(fixture, 'form');

    // Un bloque nunca cruza al dia siguiente: el backend lo rechazaria con 400 y gastar ese
    // viaje no aporta nada.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('tiene que ser posterior a la de inicio');

    // Y una hora mal escrita se senala en el campo, no al pie.
    escribir(fixture, '#alta-bloque-desde', '9:00');
    enviar(fixture, 'form');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('Escribi la hora de inicio como HH:MM');

    // Deseleccionar vuelve al estado inicial sin consultar nada: la semana que quedaba en
    // pantalla era de un profesional que ya no esta elegido.
    seleccionar(fixture, '#selector-profesional', '');
    expect(texto(fixture)).toContain('Elegi un profesional para ver su horario semanal');
  });

  it('un bloque dado de baja no se edita: el formulario queda deshabilitado', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    seleccionar(fixture, '#editar-bloque-dia', '5');
    enviar(fixture, 'form');

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'PUT')
      .flush(
        { type: 'https://akine.app/problems/bloque-inactivo' },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);

    // Dejar el formulario activo invitaria a reenviar algo que ya sabemos que va a fallar.
    expect(texto(fixture)).toContain('La baja no se deshace');
    const dia: HTMLSelectElement | null = fixture.nativeElement.querySelector('#editar-bloque-dia');
    expect(dia?.disabled).toBe(true);
  });

  it('si el listado de profesionales falla, se puede reintentar sin recargar la pagina', async () => {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(HorarioSemanalPage);
    fixture.detectChanges();

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush(
        { type: 'https://akine.app/problems/internal-error' },
        { status: 500, statusText: 'X' },
      );
    await estabilizar(fixture);

    // No se pide ningun horario: sin selector no hay profesional que consultar.
    httpMock.expectNone((peticion: HttpRequest<unknown>) =>
      peticion.url.includes('/disponibilidad'),
    );
    expect(fixture.nativeElement.querySelector('#selector-profesional')).toBeNull();

    abrir(fixture, 'Reintentar');
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush({ content: [ANA], page: 0, size: 100, totalElements: 1, totalPages: 1 });
    await estabilizar(fixture);

    expect(fixture.nativeElement.querySelector('#selector-profesional')).not.toBeNull();
    // Sin `consultorio:manage` no se ofrece ninguna accion que termine en 403.
    expect(texto(fixture)).not.toContain('Agregar un bloque');
  });

  /**
   * Lo que fallo es una LECTURA de colaboradores, no una mutacion del horario.
   *
   * <p>El traductor de bloques redacta su 403 desde la mutacion —"no tenes permiso para
   * administrar el horario"— y este endpoint pide `colaborador:read`. Quien administre el centro
   * lee ese cartel y otorga `consultorio:manage`, que no destraba nada. Es el mismo arreglo que
   * el horario efectivo ya tenia.
   */
  it('un 403 al leer los colaboradores nombra colaborador:read, no "administrar el horario"', async () => {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(HorarioSemanalPage);
    fixture.detectChanges();

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush(
        { type: 'https://akine.app/problems/forbidden', detail: 'Sin permiso' },
        { status: 403, statusText: 'Forbidden' },
      );
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('colaborador:read');
    expect(contenido).not.toContain('administrar el horario');
  });

  /**
   * El numero del bloque tiene que verse, porque otra pantalla lo NOMBRA.
   *
   * <p>El horario efectivo explica cada franja con "la produjo el horario semanal, bloque numero
   * 100". Con dos bloques parecidos en el mismo dia, esa frase no identifica ninguno si la
   * grilla no muestra el numero.
   */
  it('cada bloque muestra su numero: es la referencia que usa el horario efectivo', async () => {
    const fixture = await montar();
    const contenido = texto(fixture);

    expect(contenido).toContain('bloque numero 100');
    expect(contenido).toContain('bloque numero 101');
    expect(contenido).toContain('bloque numero 102');
  });

  /** Venir desde una explicacion del horario efectivo abre la semana de esa persona. */
  it('un enlace con profesional abre su horario sin volver a elegirlo en la lista', async () => {
    queryParams = { membershipId: String(PROFESIONAL) };

    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(HorarioSemanalPage);
    fixture.detectChanges();

    // El horario sale sin esperar a la lista de vinculos: son dos peticiones independientes.
    httpMock.expectOne(BLOQUES).flush(HORARIO);
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush({ content: [ANA], page: 0, size: 100, totalElements: 1, totalPages: 1 });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('09:00 a 12:00');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
        '#selector-profesional',
      )?.value,
    ).toBe(String(PROFESIONAL));
  });

  /**
   * "No hay profesionales" no se afirma sobre una nomina recortada.
   *
   * <p>`listMemberships` no filtra por sede y el backend recorta la pagina en cien. Si los cien
   * primeros vinculos de una organizacion grande no incluyen a ninguno de esta sede, la pantalla
   * decia "no hay profesionales con un vinculo vigente", que es falso y manda a Colaboradores a
   * arreglar vinculos que estan perfectos.
   */
  it('con la nomina recortada no afirma que no haya profesionales: dice que la lista puede faltar', async () => {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(HorarioSemanalPage);
    fixture.detectChanges();

    // Cien vinculos que llegaron, ninguno profesional de esta sede, y 250 en total.
    const relleno = Array.from({ length: 100 }, (_, indice) => ({
      ...RECEPCION,
      id: 1000 + indice,
    }));

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush({ content: relleno, page: 0, size: 100, totalElements: 250, totalPages: 3 });
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).not.toContain('No hay profesionales con un vinculo vigente');
    expect(contenido).toContain('la lista puede estar incompleta');
    // El selector sigue en pie: los que llegaron se pueden elegir igual.
    expect(fixture.nativeElement.querySelector('#selector-profesional')).not.toBeNull();
  });

  it('sin sede elegida no consulta ningun horario y ofrece elegir consultorio', async () => {
    // Contexto con organizacion pero SIN sede: el horario cuelga de una sede concreta.
    tenantContext.select({ organizationId: ORG, organizationName: 'Belgrano' });

    const fixture = TestBed.createComponent(HorarioSemanalPage);
    fixture.detectChanges();
    await estabilizar(fixture);

    httpMock.expectNone((peticion: HttpRequest<unknown>) =>
      peticion.url.includes('/disponibilidad'),
    );
    httpMock.match(RUTA_PERMISOS_EFECTIVOS).forEach((p) => p.flush({ permissions: [] }));

    const contenido = texto(fixture);
    expect(contenido).toContain('Todavia no elegiste un consultorio');
    // La salida es elegir sede, NO re-autenticarse: las credenciales estan bien.
    expect(contenido).toContain('Tu sesion sigue abierta');
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
  });

  it(
    'la pantalla no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  /** Monta la pantalla con contexto, permiso de gestion, el selector cargado y Ana elegida. */
  async function montar(): Promise<ComponentFixture<HorarioSemanalPage>> {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({ permissions: [PERMISO_CONSULTORIO_MANAGE] });

    const fixture = TestBed.createComponent(HorarioSemanalPage);
    fixture.detectChanges();

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === rutaMemberships(ORG))
      .flush({
        content: [ANA, RECEPCION, OTRA_SEDE],
        page: 0,
        size: 100,
        totalElements: 3,
        totalPages: 1,
      });
    await estabilizar(fixture);

    seleccionar(fixture, '#selector-profesional', String(PROFESIONAL));

    httpMock.expectOne(BLOQUES).flush(HORARIO);
    await estabilizar(fixture);

    return fixture;
  }
});

async function estabilizar(fixture: ComponentFixture<HorarioSemanalPage>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}

function abrir(fixture: { nativeElement: HTMLElement; detectChanges(): void }, etiqueta: string) {
  const boton = [...fixture.nativeElement.querySelectorAll('button')].find(
    (candidato) => (candidato.textContent ?? '').trim() === etiqueta,
  );
  if (boton === undefined) {
    throw new Error(`No existe el boton ${etiqueta}`);
  }
  boton.click();
  fixture.detectChanges();
}

function escribir(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const campo = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el campo ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function seleccionar(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const desplegable = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
    selector,
  );
  if (desplegable === null) {
    throw new Error(`No existe el desplegable ${selector}`);
  }
  desplegable.value = valor;
  desplegable.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const formulario = (fixture.nativeElement as HTMLElement).querySelector<HTMLFormElement>(
    selector,
  );
  // Falla cerrado. Con `?.` este helper se volvia un no-op silencioso ante un selector que
  // no casa, y TODOS los `expectNone` del spec pasaban sin que se enviara nada: el spec
  // quedaba verde afirmando que la pantalla no sale a la red.
  if (formulario === null) {
    throw new Error(`No existe el formulario ${selector}`);
  }
  formulario.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}

function campo(fixture: { nativeElement: HTMLElement }, selector: string): string {
  return (
    (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(selector)?.value ?? ''
  );
}
