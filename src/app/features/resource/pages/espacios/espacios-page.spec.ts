import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { EspaciosPage } from './espacios-page';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

/** Box operativo, con nota y con fin de vigencia cargado: el que se edita en el spec. */
const BOX_1 = {
  id: 10,
  organizationId: 1,
  consultorioId: 3,
  name: 'Box 1',
  tipo: 'BOX',
  capacidad: 1,
  notes: 'Camilla electrica',
  validFrom: '2026-01-05T09:00:00Z',
  validUntil: '2027-01-05T09:00:00Z',
  estado: 'ACTIVO',
  enServicio: true,
  version: 2,
};

/**
 * El caso que da nombre a la etapa: ACTIVO y todavia sin servicio.
 *
 * <p>Existe, no esta dado de baja, y aun asi no se ofrece para reservar porque su ventana
 * arranca el mes que viene.
 */
const BOX_FUTURO = {
  id: 11,
  organizationId: 1,
  consultorioId: 3,
  name: 'Box 4',
  tipo: 'BOX',
  capacidad: 1,
  validFrom: '2099-09-01T00:00:00Z',
  estado: 'ACTIVO',
  enServicio: false,
  version: 1,
};

const PAGINA = {
  content: [BOX_1, BOX_FUTURO],
  page: 0,
  size: 20,
  totalElements: 2,
  totalPages: 1,
};

/** Espacio de capacidad multiple y SIN fin de vigencia: la fila que BOX_1 no cubre. */
const GIMNASIO = {
  id: 12,
  organizationId: 1,
  consultorioId: 3,
  name: 'Gimnasio',
  tipo: 'GIMNASIO',
  capacidad: 8,
  validFrom: '2026-01-05T09:00:00Z',
  estado: 'ACTIVO',
  enServicio: true,
  version: 5,
};

/** Un espacio dado de baja: sigue en el listado con su motivo y no se edita. */
const BOX_DADO_DE_BAJA = {
  id: 13,
  organizationId: 1,
  consultorioId: 3,
  name: 'Box 9',
  tipo: 'BOX',
  capacidad: 1,
  validFrom: '2026-01-05T09:00:00Z',
  estado: 'INACTIVO',
  enServicio: false,
  deletedAt: '2026-08-30T12:00:00Z',
  deactivationReason: 'Se desarmo para ampliar el gimnasio',
  version: 7,
};

/** Lo que devuelve el filtro "Todos": uno vigente y uno dado de baja. */
const PAGINA_MIXTA = {
  content: [GIMNASIO, BOX_DADO_DE_BAJA],
  page: 0,
  size: 20,
  totalElements: 2,
  totalPages: 1,
};

const LISTADO = '/api/v1/organizations/1/consultorios/3/espacios';

/**
 * Spec de la pantalla de espacios (M04, AKINE-02.02).
 *
 * <p>Cubre las dos cosas que, si se rompen, <b>no dan ningun error visible</b>:
 *
 * <ol>
 *   <li>Que un espacio ACTIVO fuera de su ventana se distinga de uno operativo y explique por
 *       que no se ofrece. Sin eso la fila se ve igual que la de un box en servicio y el bug se
 *       reporta contra la agenda.</li>
 *   <li>La semantica del `PATCH`: omitido no se toca, `notes: ''` borra, y `clearValidUntil`
 *       es la unica forma de pedir "sacale el fin de vigencia". Un formulario que mande
 *       siempre todo borra datos que nadie pidio borrar, y responde `200`.</li>
 * </ol>
 *
 * <p>El resto de los conflictos comparte el camino de traduccion que ya se ejercita en
 * `espacio-errors`; no se repite una vez por cada `409`.
 */
describe('EspaciosPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EspaciosPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
    permisos = TestBed.inject(PermissionsStore);
  });

  afterEach(() => httpMock.verify());

  it('un espacio activo fuera de su ventana se distingue y dice por que no se ofrece', async () => {
    const fixture = await montar();
    const contenido = texto(fixture);

    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(2);

    // El box operativo y el futuro NO comparten el rotulo de estado.
    expect(contenido).toContain('Activo y en servicio');
    expect(contenido).toContain('Activo, todavia sin servicio');
    expect(contenido).toContain('no aparece en los selectores de reserva');

    // La capacidad se muestra como capacidad. En ningun lado se rotula un box como "libre" ni
    // "disponible": hoy la ocupacion es siempre 0 y ese cartel pasaria a mentir solo el dia
    // que exista la agenda, sin que el contrato cambie.
    expect(contenido).toContain('1 persona a la vez');
    expect(contenido).not.toMatch(/lugares? libres?/i);

    // La region de la tabla es enfocable: sin esto, en tablet vertical la columna de acciones
    // queda fuera del alcance del teclado, que es WCAG 2.1.1 nivel A. Ningun axe lo detecta
    // porque depende del layout, que jsdom no calcula.
    const region = fixture.nativeElement.querySelector('.tabla-scroll');
    expect(region?.getAttribute('tabindex')).toBe('0');
    expect(region?.getAttribute('role')).toBe('region');
    expect(region?.getAttribute('aria-label')).toBeTruthy();
  });

  it('sin sede elegida no consulta nada y ofrece elegir consultorio, no cerrar sesion', async () => {
    // Contexto con organizacion pero SIN sede: los espacios cuelgan de una sede concreta, asi
    // que la peticion seria invalida.
    tenantContext.select({ organizationId: 1, organizationName: 'Belgrano' });

    const fixture = TestBed.createComponent(EspaciosPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // No se pide ningun espacio: sin sede la URL no existiria. Lo que si sale es la carga de
    // permisos, que esta pantalla dispara por su cuenta porque su ruta no lleva
    // `permissionGuard` -sin eso, `*akinePermiso` esconderia todas las acciones-.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url.includes('/espacios'));
    httpMock
      .match('/api/v1/me/permissions')
      .forEach((peticion) => peticion.flush({ permissions: [] }));

    const contenido = texto(fixture);
    expect(contenido).toContain('Todavia no elegiste un consultorio');
    // Lo importante: la salida es elegir sede, NO re-autenticarse. Las credenciales estan bien
    // y volver a entrar no elegiria ninguna sede, dejando al usuario en el mismo bucle.
    expect(contenido).toContain('Tu sesion sigue abierta');
    const salida = fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]');
    expect(salida).not.toBeNull();
  });

  it('el listado vacio no es un error, y el filtro de inactivos lo dice distinto', async () => {
    const fixture = await montar();

    const selector: HTMLSelectElement | null =
      fixture.nativeElement.querySelector('#filtro-estado-espacio');
    if (selector === null) {
      throw new Error('No existe el filtro de estado');
    }
    selector.value = 'INACTIVO';
    selector.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const recarga = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === LISTADO && peticion.params.get('estado') === 'INACTIVO',
    );
    recarga.flush({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
    await fixture.whenStable();
    fixture.detectChanges();

    // "No hay dados de baja" y "no hay nada con este filtro" son dos cosas distintas: la
    // primera es una respuesta a la pregunta que se hizo, la segunda suena a que algo fallo.
    expect(texto(fixture)).toContain('No hay espacios dados de baja');
  });

  it('el PATCH manda solo lo que cambio: la nota vaciada, el fin quitado y nada mas', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');

    // Se BORRA la nota vaciandola y se pide quitar el fin de vigencia con la casilla. Nombre,
    // tipo, capacidad e inicio de vigencia quedan como estaban.
    escribir(fixture, '#editar-espacio-notes', '');
    marcar(fixture, '#editar-espacio-clear');

    enviar(fixture, 'form');

    const peticion = httpMock.expectOne(
      (candidata: HttpRequest<unknown>) => candidata.method === 'PATCH',
    );
    const cuerpo = peticion.request.body as Record<string, unknown>;

    expect(cuerpo).toEqual({ version: 2, notes: '', clearValidUntil: true });

    // Nada de lo intacto viaja. `validFrom` es el caso traicionero: dio la vuelta por el
    // control del navegador y vuelve con milisegundos, asi que comparado como texto pareceria
    // haber cambiado y se reenviaria en cada guardado.
    expect('name' in cuerpo).toBe(false);
    expect('capacidad' in cuerpo).toBe(false);
    expect('validFrom' in cuerpo).toBe(false);
    // Con la casilla marcada, `validUntil` se omite: el contrato dice que lo ignora.
    expect('validUntil' in cuerpo).toBe(false);

    peticion.flush({ ...BOX_1, notes: null, validUntil: null, version: 3 });
    httpMock.expectOne(esListado()).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('quedaron guardados');
  });

  it('una version vieja no pisa nada: relee el espacio, avisa y deja el panel abierto', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-espacio-name', 'Box 1 bis');
    enviar(fixture, 'form');

    httpMock
      .expectOne((candidata: HttpRequest<unknown>) => candidata.method === 'PATCH')
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification' },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    // Se relee el espacio para tomar la version nueva como base de comparacion. Reintentar en
    // silencio con ella seria justamente pisar el cambio del otro, que es lo que el 409 evita.
    httpMock.expectOne(`${LISTADO}/10`).flush({ ...BOX_1, name: 'Box 1 Sur', version: 9 });
    httpMock.expectOne(esListado()).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Alguien mas modifico este espacio');
    // El panel sigue abierto con lo escrito: cerrarlo obligaria a rehacer todo para leer el
    // mensaje, y la decision de insistir o no es del usuario.
    expect(campo(fixture, '#editar-espacio-name')).toBe('Box 1 bis');
  });

  it('un espacio dado de baja no se edita: el formulario queda deshabilitado', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-espacio-name', 'Box 1 bis');
    enviar(fixture, 'form');

    httpMock
      .expectOne((candidata: HttpRequest<unknown>) => candidata.method === 'PATCH')
      .flush(
        { type: 'https://akine.app/problems/espacio-inactive' },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    // Dejar el boton activo invitaria a reenviar algo que ya sabemos que va a fallar igual.
    expect(texto(fixture)).toContain('La baja no se deshace');
    const nombre: HTMLInputElement | null =
      fixture.nativeElement.querySelector('#editar-espacio-name');
    expect(nombre?.disabled).toBe(true);
  });

  it('la baja avisa que es irreversible antes de confirmar, y exige motivo', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de baja');

    // La irreversibilidad se dice ANTES, no en el mensaje de exito: el contrato no publica
    // ninguna operacion de reactivacion.
    expect(texto(fixture)).toContain('no se puede deshacer');
    expect(texto(fixture)).toContain('No hay reactivacion');

    // Sin motivo no sale a la red: el backend lo exige y gastar un rechazo no aporta nada.
    enviar(fixture, 'form');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(texto(fixture)).toContain('El motivo es obligatorio');

    escribir(fixture, '#baja-espacio-reason', 'Se desarma para ampliar el gimnasio');
    enviar(fixture, 'form');

    const baja = httpMock.expectOne(`${LISTADO}/10/deactivate`);
    expect(baja.request.body).toEqual({ reason: 'Se desarma para ampliar el gimnasio' });

    baja.flush({ ...BOX_1, estado: 'INACTIVO', enServicio: false });
    httpMock.expectOne(esListado()).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();

    // El nombre queda libre: es lo que evita que alguien crea que perdio el nombre para siempre.
    expect(texto(fixture)).toContain('queda libre');
  });

  it('el nombre ya tomado se muestra EN el campo nombre, no al pie del panel', async () => {
    // Es un error de UN campo. Mostrarlo al pie obliga a adivinar cual de los seis corregir, y
    // el lector de pantalla nunca lo asocia al input.
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-espacio-name', 'Box 4');
    enviar(fixture, 'form');

    httpMock
      .expectOne((candidata: HttpRequest<unknown>) => candidata.method === 'PATCH')
      .flush(
        { type: 'https://akine.app/problems/espacio-name-taken' },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const nombre: HTMLInputElement | null =
      fixture.nativeElement.querySelector('#editar-espacio-name');
    expect(nombre?.getAttribute('aria-invalid')).toBe('true');
    expect(nombre?.getAttribute('aria-describedby')).toBe('editar-espacio-name-conflicto');
    expect(fixture.nativeElement.querySelector('#editar-espacio-name-conflicto')).not.toBeNull();

    // Y no se repite al pie: el mismo texto dos veces se lee como dos problemas distintos.
    expect(fixture.nativeElement.querySelectorAll('.estado--error[role="alert"]').length).toBe(0);
    // El nombre de un espacio dado de baja SI se reusa, y eso solo lo sabe el frontend.
    expect(texto(fixture)).toContain('revisa el filtro "Todos"');
  });

  it('un 404 al guardar ofrece recargar el listado, no reintentar', async () => {
    // El espacio ya no existe: reintentar el mismo PATCH falla igual. Lo unico que sirve es
    // volver a leer que hay ahora.
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-espacio-name', 'Box 1 bis');
    enviar(fixture, 'form');

    httpMock
      .expectOne((candidata: HttpRequest<unknown>) => candidata.method === 'PATCH')
      .flush({ title: 'No existe' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Ese espacio ya no existe');

    const recargar = botonPorTexto(fixture, 'Recargar el listado');
    expect(recargar).not.toBeNull();
    recargar?.click();
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush(PAGINA);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('la baja rechazada por referencias vigentes dice cuantas son y de que tipo', async () => {
    // "No se pudo" manda a llamar a soporte; "hay 14 turnos futuros en ese box" se resuelve
    // solo. La diferencia esta en las dos extensiones del cuerpo.
    const fixture = await montar();

    abrir(fixture, 'Dar de baja');
    escribir(fixture, '#baja-espacio-reason', 'Se desarma para ampliar el gimnasio');
    enviar(fixture, 'form');

    httpMock.expectOne(`${LISTADO}/10/deactivate`).flush(
      {
        type: 'https://akine.app/problems/espacio-has-active-references',
        referenceType: 'turnos futuros',
        referenceCount: 14,
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('14 turnos futuros');
    // El panel sigue abierto: lo accionable esta en otra pantalla y cerrar el panel obligaria
    // a rehacer el motivo al volver.
    expect(fixture.nativeElement.querySelector('#baja-espacio-reason')).not.toBeNull();
  });

  it('una baja que otra persona ya hizo ofrece recargar el listado', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de baja');
    escribir(fixture, '#baja-espacio-reason', 'Se desarma para ampliar el gimnasio');
    enviar(fixture, 'form');

    httpMock
      .expectOne(`${LISTADO}/10/deactivate`)
      .flush(
        { type: 'https://akine.app/problems/espacio-already-inactive' },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('ya estaba dado de baja');
    expect(botonPorTexto(fixture, 'Recargar el listado')).not.toBeNull();
  });

  it('bajar la capacidad por debajo de lo comprometido explica con los dos numeros', async () => {
    // Es el unico 409 del modulo donde el usuario necesita DOS cifras para decidir: a cuanto
    // puede bajar hoy y cuanto hay tomado. Sin ellas solo queda "no pudimos completar".
    const fixture = await montarCon(PAGINA_MIXTA);

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-espacio-capacidad', '2');
    enviar(fixture, 'form');

    const peticion = httpMock.expectOne(
      (candidata: HttpRequest<unknown>) => candidata.method === 'PATCH',
    );
    expect((peticion.request.body as Record<string, unknown>)['capacidad']).toBe(2);

    peticion.flush(
      {
        type: 'https://akine.app/problems/espacio-capacity-below-occupancy',
        requestedCapacity: 2,
        currentOccupancy: 6,
        occupancyType: 'turnos simultaneos',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    const contenido = texto(fixture);
    expect(contenido).toContain('bajar la capacidad a 2');
    expect(contenido).toContain('6 lugares comprometidos');
    expect(contenido).toContain('turnos simultaneos');
  });

  it('un nombre vacio bloquea el guardado: no sale ningun PATCH', async () => {
    // El backend lo rechaza igual, pero un 400 por un campo obligatorio vacio es un viaje que
    // no aporta nada y deja el panel sin explicar cual campo era.
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-espacio-name', '');
    enviar(fixture, 'form');

    httpMock.expectNone((candidata: HttpRequest<unknown>) => candidata.method === 'PATCH');
    expect(texto(fixture)).toContain('El espacio necesita un nombre.');
  });

  it('un 403 de permiso ofrece reintentar y NO manda a elegir consultorio', async () => {
    // Elegir otro contexto no consigue el permiso que falta: el enlace mandaria al usuario a
    // dar vueltas por una pantalla que no cambia nada.
    const fixture = await montarConError(
      { title: 'Prohibido' },
      { status: 403, statusText: 'Forbidden' },
    );

    expect(texto(fixture)).toContain('No tenes permiso para administrar los espacios');
    expect(botonPorTexto(fixture, 'Reintentar')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).toBeNull();
  });

  it('un 403 por contexto faltante manda a elegir consultorio y no ofrece reintentar', async () => {
    // Reintentar sin contexto vuelve a fallar exactamente igual. Y nunca se cierra la sesion:
    // las credenciales estan bien, lo que falta es la sede.
    const fixture = await montarConError(
      { type: 'https://akine.app/problems/missing-tenant-context' },
      { status: 403, statusText: 'Forbidden' },
    );

    expect(texto(fixture)).toContain('todavia no elegiste ninguna');
    expect(botonPorTexto(fixture, 'Reintentar')).toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
  });

  it('un espacio dado de baja no ofrece editarlo y muestra su fecha y su motivo', async () => {
    // Ofrecer "Editar" sobre una fila dada de baja termina en un 409 garantizado, y el motivo
    // es lo que explica la decision dentro de seis meses.
    const fixture = await montarCon(PAGINA_MIXTA);

    const contenido = texto(fixture);
    expect(contenido).toContain('Dado de baja');
    expect(contenido).toContain('Motivo: Se desarmo para ampliar el gimnasio');
    expect(contenido).toContain('Un espacio dado de baja no se edita.');

    // Una sola fila es editable: la del gimnasio activo.
    const editar = [...fixture.nativeElement.querySelectorAll('button')].filter(
      (boton: HTMLButtonElement) => (boton.textContent ?? '').trim() === 'Editar',
    );
    expect(editar.length).toBe(1);

    // Y de paso: capacidad en plural y sin fin de vigencia cargado.
    expect(contenido).toContain('8 personas a la vez');
    expect(contenido).toContain('Sin fin previsto');
  });

  it('sin permiso de gestion el listado se sigue viendo pero sin ninguna accion', async () => {
    // El listado NO exige `consultorio:manage`: es la lectura que necesita un profesional para
    // saber en que box atiende. Esconder la tabla entera dejaria a media sede sin consultarla.
    const fixture = await montarCon(PAGINA, []);

    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(2);
    expect(botonPorTexto(fixture, 'Editar')).toBeNull();
    expect(botonPorTexto(fixture, 'Dar de baja')).toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/espacios/nuevo"]')).toBeNull();
  });

  /** Monta la pantalla con contexto sobre la sede 3, permiso de gestion y los dos espacios. */
  async function montar() {
    return montarCon(PAGINA);
  }

  /** Igual que {@link montar}, con otra pagina y otro juego de permisos otorgados. */
  async function montarCon(
    pagina: object,
    otorgados: readonly string[] = [PERMISO_CONSULTORIO_MANAGE],
  ) {
    const fixture = crear(otorgados);

    httpMock.expectOne(esListado()).flush(pagina);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  /** Monta la pantalla y hace fallar el listado con el problema indicado. */
  async function montarConError(cuerpo: object, opciones: { status: number; statusText: string }) {
    const fixture = crear([PERMISO_CONSULTORIO_MANAGE]);

    httpMock.expectOne(esListado()).flush(cuerpo, opciones);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  /** Contexto, permisos y componente creado, sin resolver todavia el listado. */
  function crear(otorgados: readonly string[]) {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne('/api/v1/me/permissions').flush({ permissions: [...otorgados] });

    const fixture = TestBed.createComponent(EspaciosPage);
    fixture.detectChanges();

    return fixture;
  }

  function esListado() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' && peticion.url === LISTADO && peticion.params.get('size') === '20';
  }
});

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}

/** El boton cuyo texto contiene `etiqueta`, o `null`. Para afirmar que NO se ofrece una accion. */
function botonPorTexto(
  fixture: { nativeElement: HTMLElement },
  etiqueta: string,
): HTMLButtonElement | null {
  return (
    [...fixture.nativeElement.querySelectorAll('button')].find((candidato) =>
      (candidato.textContent ?? '').trim().includes(etiqueta),
    ) ?? null
  );
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
  const campo = fixture.nativeElement.querySelector<HTMLInputElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el campo ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function marcar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const casilla = fixture.nativeElement.querySelector<HTMLInputElement>(selector);
  if (casilla === null) {
    throw new Error(`No existe la casilla ${selector}`);
  }
  casilla.checked = true;
  casilla.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const formulario = fixture.nativeElement.querySelector<HTMLFormElement>(selector);
  formulario?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}

function campo(fixture: { nativeElement: HTMLElement }, selector: string): string {
  return fixture.nativeElement.querySelector<HTMLInputElement>(selector)?.value ?? '';
}
