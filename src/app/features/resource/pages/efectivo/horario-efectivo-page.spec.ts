import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { HorarioEfectivoPage } from './horario-efectivo-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';
import { rutaDisponibilidadEfectiva, rutaMemberships } from '../../../../core/testing/rutas-api';

const ORG = 1;
const SEDE = 3;
const PROFESIONAL = 42;
const ZONA = 'America/Argentina/Buenos_Aires';

const MEMBERSHIPS = rutaMemberships(ORG);
const EFECTIVA = rutaDisponibilidadEfectiva(SEDE, PROFESIONAL);

const VINCULOS = {
  content: [
    {
      id: PROFESIONAL,
      accountName: 'Ana Diaz',
      accountEmail: 'ana@ejemplo.test',
      roleCode: 'PROFESIONAL',
      estado: 'ACTIVA',
      consultorioId: SEDE,
    },
    {
      id: 7,
      accountName: 'Beto Perez',
      accountEmail: 'beto@ejemplo.test',
      roleCode: 'RECEPCION',
      estado: 'ACTIVA',
      consultorioId: SEDE,
    },
  ],
};

/** Un dia con atencion producido por el horario semanal. */
const MARTES = {
  fecha: '2026-09-01',
  esFeriado: false,
  feriadoNombre: null,
  razonVacio: null,
  reglaVacio: null,
  franjas: [
    {
      desde: '2026-09-01T12:00:00Z',
      hasta: '2026-09-01T16:00:00Z',
      origen: 'BLOQUE',
      reglaId: 5,
      recortadoPor: null,
    },
  ],
};

/**
 * Spec del horario efectivo (M05, AKINE-02.04).
 *
 * <p>Esta pantalla es el criterio de aceptacion de la etapa hecho visible, asi que lo que estos
 * tests fijan no es que los dias se dibujen -eso no le sirve a nadie- sino que
 * <b>la explicacion correcta salga en cada uno de los cuatro estados de un dia vacio</b> y que
 * una franja recortada diga quien la recorto. Los cuatro literales de `razonVacio` viajan como
 * `string | null` y el compilador no los chequea: si alguien escribe uno mal, esto es lo unico
 * que lo atrapa.
 */
describe('HorarioEfectivoPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HorarioEfectivoPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
  });

  afterEach(() => httpMock.verify());

  it('cada franja muestra la regla que la produjo y la hora de pared de la sede', async () => {
    const fixture = await resolver({
      timezone: ZONA,
      dias: [
        MARTES,
        {
          fecha: '2026-09-02',
          esFeriado: false,
          razonVacio: null,
          franjas: [
            {
              desde: '2026-09-02T13:00:00Z',
              hasta: '2026-09-02T17:00:00Z',
              origen: 'APERTURA',
              reglaId: 31,
              recortadoPor: null,
            },
          ],
        },
      ],
    });

    const contenido = texto(fixture);

    // 12:00Z en Buenos Aires son las 09:00: la hora es la de la sede, no la del navegador.
    expect(contenido).toContain('09:00 a 13:00');
    expect(contenido).toContain('La produjo el horario semanal, bloque numero 5.');

    // Y la apertura puntual NO se confunde con el horario habitual: es la diferencia entre
    // "asi trabaja siempre" y "asi trabaja esta semana".
    expect(contenido).toContain('10:00 a 14:00');
    expect(contenido).toContain('La produjo una apertura puntual numero 31.');

    // La zona con la que se resolvio se rotula: un error de huso se ve, no se deduce.
    expect(contenido).toContain(ZONA);
    expect(contenido).toContain('2 de 2 dias con atencion');
  });

  it('una franja recortada dice que la recorto un cierre', async () => {
    const fixture = await resolver({
      timezone: ZONA,
      dias: [
        {
          fecha: '2026-09-01',
          esFeriado: false,
          razonVacio: null,
          franjas: [
            {
              desde: '2026-09-01T12:00:00Z',
              hasta: '2026-09-01T14:00:00Z',
              origen: 'BLOQUE',
              reglaId: 5,
              recortadoPor: 'CIERRE',
            },
          ],
        },
      ],
    });

    const contenido = texto(fixture);

    // La pregunta que responde: por que termina a las 11 si el bloque llega hasta las 13.
    expect(contenido).toContain('09:00 a 11:00');
    expect(contenido).toContain('Recortada por un cierre');
    expect(contenido).toContain('termina antes de lo que dice la regla que la produjo');
  });

  it('un dia vaciado por feriado muestra el NOMBRE del feriado', async () => {
    const fixture = await resolver({
      timezone: ZONA,
      dias: [
        {
          fecha: '2026-12-25',
          esFeriado: true,
          feriadoNombre: 'Navidad',
          razonVacio: 'FERIADO',
          reglaVacio: null,
          franjas: [],
        },
      ],
    });

    const contenido = texto(fixture);

    // Un dia que solo dijera "cerrado" manda a buscar un cierre que nadie cargo.
    expect(contenido).toContain('Cerrado por el feriado: Navidad.');
    expect(contenido).toContain('La sede cierra los feriados de su calendario');
    expect(contenido).toContain('Ver los feriados de la sede');
    expect(contenido).toContain('0 de 1 dias con atencion');
  });

  it('un dia tapado por un cierre nombra la excepcion y manda a la pantalla que la administra', async () => {
    const fixture = await resolver({
      timezone: ZONA,
      dias: [
        {
          fecha: '2026-09-02',
          esFeriado: false,
          razonVacio: 'CIERRE',
          reglaVacio: 77,
          franjas: [],
        },
      ],
    });

    const contenido = texto(fixture);

    expect(contenido).toContain('Cerrado por un cierre cargado.');
    expect(contenido).toContain('La excepcion de cierre numero 77 cubre el dia entero.');
    expect(contenido).toContain('Ver los cierres y las aperturas');
    // Es la unica de las cuatro razones que se resuelve dando de baja algo.
    expect(contenido).toContain('se deshace dandolo de baja');

    // El salto lleva consigo de quien y de que dia se hablaba. Sin esto aterriza en la vista
    // por defecto -solo las de toda la sede, noventa dias desde hoy- donde un cierre de Ana no
    // figura, y el numero 77 que se acaba de leer no lleva a ninguna parte.
    // Dentro del dia, no en la barra de navegacion de arriba: ese enlace tambien apunta a
    // excepciones y es el que aparece primero en el documento.
    const enlace = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      '.dia-efectivo a[href^="/horarios/excepciones"]',
    );
    expect(enlace?.getAttribute('href')).toBe(
      `/horarios/excepciones?membershipId=${PROFESIONAL}&desde=2026-09-02&hasta=2026-09-03`,
    );
  });

  it('un dia sin vinculo vigente dice que no trabajaba ahi todavia, no que no atiende ese dia', async () => {
    const fixture = await resolver({
      timezone: ZONA,
      dias: [
        {
          fecha: '2026-09-03',
          esFeriado: false,
          razonVacio: 'VINCULO',
          reglaVacio: null,
          franjas: [],
        },
      ],
    });

    const contenido = texto(fixture);

    expect(contenido).toContain('Ana Diaz no estaba vinculado a la sede ese dia.');
    expect(contenido).toContain('todavia no se habia incorporado');
    expect(contenido).toContain('ya se habia desvinculado');
    // La confusion que esta pantalla existe para evitar: los dos carteles NO son el mismo.
    expect(contenido).not.toContain('No trabaja ese dia');
    expect(contenido).not.toContain('Cerrado por');
  });

  it('un dia sin ninguna regla dice que no trabaja ese dia y no ofrece ningun cierre que mirar', async () => {
    const fixture = await resolver({
      timezone: ZONA,
      dias: [
        {
          fecha: '2026-09-05',
          esFeriado: false,
          razonVacio: null,
          reglaVacio: null,
          franjas: [],
        },
      ],
    });

    const contenido = texto(fixture);

    expect(contenido).toContain('No trabaja ese dia.');
    expect(contenido).toContain('Ninguna regla abre ese dia');
    expect(contenido).toContain('No hay ningun cierre ni feriado de por medio');
    expect(contenido).toContain('Ver el horario semanal');
    expect(contenido).not.toContain('Ver los cierres y las aperturas');
  });

  it('una franja que llega al fin del dia se escribe 24:00', async () => {
    const fixture = await resolver({
      timezone: ZONA,
      dias: [
        {
          fecha: '2026-09-01',
          esFeriado: false,
          razonVacio: null,
          franjas: [
            {
              // El contrato manda el INICIO DEL DIA SIGUIENTE, no las 23:59:59.
              desde: '2026-09-01T23:00:00Z',
              hasta: '2026-09-02T03:00:00Z',
              origen: 'BLOQUE',
              reglaId: 8,
              recortadoPor: null,
            },
          ],
        },
      ],
    });

    const contenido = texto(fixture);

    expect(contenido).toContain('20:00 a 24:00');
    // "20:00 a 00:00" se lee como una franja invertida.
    expect(contenido).not.toContain('20:00 a 00:00');
  });

  it('un feriado en el que la sede ATIENDE se marca igual y se explica', async () => {
    const fixture = await resolver({
      timezone: ZONA,
      dias: [
        {
          fecha: '2026-12-25',
          // El hecho del calendario vale aunque el centro atienda: no es la decision de la sede.
          esFeriado: true,
          feriadoNombre: 'Navidad',
          razonVacio: null,
          franjas: [
            {
              desde: '2026-12-25T12:00:00Z',
              hasta: '2026-12-25T16:00:00Z',
              origen: 'APERTURA',
              reglaId: 12,
              recortadoPor: null,
            },
          ],
        },
      ],
    });

    const contenido = texto(fixture);

    expect(contenido).toContain('Feriado');
    expect(contenido).toContain('Navidad');
    expect(contenido).toContain('y aun asi se atiende');
    expect(contenido).toContain('09:00 a 13:00');
  });

  it('el selector solo ofrece vinculos que habilitan a atender en esta sede', async () => {
    const fixture = await montar();

    const opciones = [...fixture.nativeElement.querySelectorAll('#efectivo-profesional option')];
    const etiquetas = opciones.map((opcion: Element) => (opcion.textContent ?? '').trim());

    expect(etiquetas).toContain('Ana Diaz');
    // Recepcion no atiende: ofrecerla seria ofrecer un camino que termina en un rechazo.
    expect(etiquetas).not.toContain('Beto Perez');
  });

  it('sin profesional elegido no sale ninguna consulta a la red', async () => {
    const fixture = await montar();

    enviar(fixture, '#form-ventana');

    // La frase COMPLETA, y no el prefijo: "Eligi un profesional" tambien es la etiqueta de la
    // opcion vacia del selector y parte del parrafo inicial, asi que esta en el DOM pase lo que
    // pase. Afirmando solo eso, borrar el `errorVentana.set(...)` de `consultar()` dejaba el
    // test igual de verde.
    expect(texto(fixture)).toContain('Eligi un profesional para resolver su horario.');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url === EFECTIVA);
  });

  it('una ventana invertida y una sobre el tope se frenan antes de gastar el viaje', async () => {
    const fixture = await elegir(await montar());
    responder(fixture, { timezone: ZONA, dias: [MARTES] });

    escribir(fixture, '#efectivo-hasta', '2020-01-01');
    enviar(fixture, '#form-ventana');
    expect(texto(fixture)).toContain('tiene que ser posterior al inicio');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url === EFECTIVA);

    escribir(fixture, '#efectivo-desde', '2026-01-01');
    escribir(fixture, '#efectivo-hasta', '2028-01-01');
    enviar(fixture, '#form-ventana');
    expect(texto(fixture)).toContain('no puede superar los 366 dias');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url === EFECTIVA);

    escribir(fixture, '#efectivo-hasta', '');
    enviar(fixture, '#form-ventana');
    expect(texto(fixture)).toContain('Completa las dos fechas');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url === EFECTIVA);
  });

  it('un fallo de la consulta habla de LEER el horario y ofrece reintentar', async () => {
    const fixture = await elegir(await montar());

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === EFECTIVA)
      .flush(
        { type: 'https://akine.app/problems/forbidden', detail: 'sin permiso' },
        { status: 403, statusText: 'Forbidden' },
      );
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('colaborador:read');
    // La pantalla no muta nada: pedir `consultorio:manage` mandaria a otorgar el permiso que no
    // es.
    expect(contenido).not.toContain('administrar');

    abrir(fixture, 'Reintentar');
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === EFECTIVA)
      .flush({ timezone: ZONA, dias: [MARTES] });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('09:00 a 13:00');
  });

  it('la falta de contexto manda a elegir sede en vez de ofrecer un reintento inutil', async () => {
    const fixture = await elegir(await montar());

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === EFECTIVA)
      .flush(
        { type: 'https://akine.app/problems/missing-tenant-context', detail: 'sin contexto' },
        { status: 403, statusText: 'Forbidden' },
      );
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('Eligi un consultorio');
    expect(contenido).not.toContain('Reintentar');
  });

  it('si falla la lista de profesionales se reintenta sola, sin tocar la consulta', async () => {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    const fixture = TestBed.createComponent(HorarioEfectivoPage);
    fixture.detectChanges();

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === MEMBERSHIPS)
      // Sin cuerpo de Problem Details: es el 500 que no puede explicarse solo.
      .flush(null, { status: 500, statusText: 'Server Error' });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No pudimos resolver el horario');

    abrir(fixture, 'Reintentar la lista de profesionales');
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === MEMBERSHIPS)
      .flush(VINCULOS);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Ana Diaz');
  });

  /**
   * Una sede sin profesionales lo dice; no se confunde con una consulta caida.
   *
   * <p>Antes esta pantalla respondia a las dos cosas con el mismo desplegable de una sola
   * opcion. El horario semanal ya distinguia los dos casos y ofrecia la salida —el horario
   * cuelga del vinculo, asi que se arregla en Colaboradores—; aca faltaba.
   */
  it('sin profesionales vinculados lo dice y manda a Colaboradores, no a un desplegable vacio', async () => {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    const fixture = TestBed.createComponent(HorarioEfectivoPage);
    fixture.detectChanges();

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === MEMBERSHIPS)
      .flush({ content: [] });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No hay profesionales con un vinculo vigente');
    expect(fixture.nativeElement.querySelector('#efectivo-profesional')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('a[href="/organizacion/colaboradores"]'),
    ).not.toBeNull();
  });

  /**
   * El desplegable no puede seguir mostrando a alguien que ya no esta elegido.
   *
   * <p>Al cambiar de sede el signal vuelve a `null`, pero un `<select>` sin `[value]` conserva
   * lo que el navegador dibujo: la pantalla queda diciendo "Ana Diaz" mientras el estado dice
   * que no hay nadie, y "Resolver" contesta "Eligi un profesional" con un nombre a la vista.
   */
  it('al cambiar de sede el desplegable vuelve a "Elegi un profesional" y no queda con el anterior', async () => {
    const fixture = await elegir(await montar());

    responder(fixture, { timezone: ZONA, dias: [MARTES] });
    await estabilizar(fixture);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
        '#efectivo-profesional',
      )?.value,
    ).toBe(String(PROFESIONAL));

    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: 9,
      consultorioName: 'Sede Norte',
    });
    fixture.detectChanges();

    // Alcance de organizacion: el mismo vinculo habilita tambien en la sede nueva, asi que el
    // desplegable existe y lo que se mira es que NO haya quedado con el valor anterior.
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === MEMBERSHIPS)
      .flush({ content: [{ ...VINCULOS.content[0], consultorioId: null }] });
    await estabilizar(fixture);

    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
        '#efectivo-profesional',
      )?.value,
    ).toBe('');
  });

  it('sin consultorio elegido no consulta nada y explica que falta', async () => {
    tenantContext.select({ organizationId: ORG, organizationName: 'Belgrano' });

    const fixture = TestBed.createComponent(HorarioEfectivoPage);
    fixture.detectChanges();
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Todavia no elegiste un consultorio');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url === MEMBERSHIPS);
  });

  it('una ventana que no devuelve dias lo dice, en vez de quedar en blanco', async () => {
    const fixture = await resolver({ timezone: ZONA, dias: [] });

    expect(texto(fixture)).toContain('no devolvio ningun dia');
  });

  it(
    'la pantalla no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await resolver({ timezone: ZONA, dias: [MARTES] });
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  // =====================================================================================
  // Montaje
  // =====================================================================================

  async function montar(): Promise<ComponentFixture<HorarioEfectivoPage>> {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    const fixture = TestBed.createComponent(HorarioEfectivoPage);
    fixture.detectChanges();

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === MEMBERSHIPS)
      .flush(VINCULOS);
    await estabilizar(fixture);

    return fixture;
  }

  /** Elige a Ana en el selector. Deja la consulta de efectiva pendiente de respuesta. */
  async function elegir(
    fixture: ComponentFixture<HorarioEfectivoPage>,
  ): Promise<ComponentFixture<HorarioEfectivoPage>> {
    const selector = fixture.nativeElement.querySelector(
      '#efectivo-profesional',
    ) as HTMLSelectElement;
    selector.value = String(PROFESIONAL);
    selector.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    return fixture;
  }

  function responder(
    fixture: ComponentFixture<HorarioEfectivoPage>,
    cuerpo: Record<string, unknown>,
  ): void {
    // El matcher filtra por `request.url`: todas las lecturas de este modulo llevan query
    // string, y `expectOne(url)` compara contra `urlWithParams`, asi que no casaria nunca.
    const peticion = httpMock.expectOne(
      (candidata: HttpRequest<unknown>) => candidata.url === EFECTIVA,
    );
    expect(peticion.request.params.get('desde')).not.toBeNull();
    expect(peticion.request.params.get('hasta')).not.toBeNull();
    peticion.flush(cuerpo);
    fixture.detectChanges();
  }

  /** Monta, elige profesional y responde la consulta con el cuerpo dado. */
  async function resolver(
    cuerpo: Record<string, unknown>,
  ): Promise<ComponentFixture<HorarioEfectivoPage>> {
    const fixture = await elegir(await montar());
    responder(fixture, cuerpo);
    await estabilizar(fixture);
    return fixture;
  }
});

async function estabilizar(fixture: ComponentFixture<HorarioEfectivoPage>): Promise<void> {
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
