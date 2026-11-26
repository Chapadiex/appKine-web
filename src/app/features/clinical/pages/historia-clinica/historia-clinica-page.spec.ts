import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { HistoriaClinicaPage } from './historia-clinica-page';
import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { VisitaClinica } from '../../services/visita-clinica';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { By } from '@angular/platform-browser';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { PERMISO_HC_DECLARAR, PERMISO_HC_WRITE } from '../../../../core/models/permisos';
import { TimelineClinico } from './components/timeline-clinico';

const PERSONA = 12;
const HC = 88;
const HISTORIA_POR_PERSONA = `/api/v1/historias-clinicas/por-persona/${PERSONA}`;
const TIMELINE = `/api/v1/historias-clinicas/${HC}/timeline`;
const CASOS = `/api/v1/historias-clinicas/${HC}/casos`;
const HEADER = 'X-Justificacion-Acceso';

const HISTORIA = {
  id: HC,
  personaId: PERSONA,
  personaNombreCompleto: 'Prueba, Lucia',
  personaDocumento: 'DNI 30111222',
  abiertaEn: '2026-09-01T12:00:00Z',
  resumen: 'Lumbalgia cronica.',
  antecedentes: [{ id: 5, tipo: 'ALERGIA', descripcion: 'Penicilina', vigente: true }],
  version: 2,
};

const PAGINA = {
  eventos: [
    {
      ocurrioEn: '2026-09-10T15:00:00Z',
      origen: 'ENTRADA_CLINICA',
      referencia: 41,
      tipo: 'EVOLUCION',
      titulo: 'Entrada clínica',
    },
  ],
};

// La forma de 0.107.0: tipo propio, y la extension de antes que el backend sigue mandando.
const SIN_RELACION = {
  type: 'https://akine.app/problems/justificacion-de-acceso-requerida',
  status: 403,
  detail: 'Hace falta declarar el motivo del acceso.',
  requiereJustificacion: true,
};

/**
 * La pantalla de la Historia Clinica (D-a). Lo que se prueba es lo que no se ve en el E2E feliz:
 * que el motivo viaje en CADA pedido de la visita y no solo en el primero, y que un pedido sin
 * motivo no salga cuando el campo esta vacio.
 */
describe('HistoriaClinicaPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HistoriaClinicaPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        VisitaClinica,
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
  });

  afterEach(() => {
    // Las ofertas de la sede son accesorias (nombres en los casos): se contestan vacias.
    httpMock.match((r) => r.url.endsWith('/ofertas')).forEach((r) => r.flush([]));
    // Los permisos de la cabecera de la persona también son accesorios.
    httpMock
      .match((r) => r.url.endsWith('/me/permissions'))
      .forEach((r) => r.flush({ permissions: [] }));
    httpMock.verify();
  });

  it('sin relación asistencial pide motivo, y después lo manda en cada pedido de la visita', async () => {
    const fixture = await montar();

    const primero = httpMock.expectOne((r) => r.url === HISTORIA_POR_PERSONA);
    expect(primero.request.headers.has(HEADER)).toBe(false);
    primero.flush(SIN_RELACION, { status: 403, statusText: 'Forbidden' });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Declará el motivo del acceso');

    // Vacio no sale nada.
    enviarMotivo(fixture, '   ');
    await estabilizar(fixture);
    httpMock.expectNone((r) => r.url === HISTORIA_POR_PERSONA);
    expect(texto(fixture)).toContain('Sin motivo no se puede seguir.');

    enviarMotivo(fixture, 'Interconsulta');
    const conMotivo = httpMock.expectOne((r) => r.url === HISTORIA_POR_PERSONA);
    expect(conMotivo.request.headers.get(HEADER)).toBe('Interconsulta');
    conMotivo.flush(HISTORIA);
    await estabilizar(fixture);

    // El timeline y los casos del filtro tambien llevan el motivo: cada lectura se audita.
    // La lista de sesiones sale del mismo timeline, filtrado por origen SESION.
    const timelines = httpMock.match((r: HttpRequest<unknown>) => r.url === TIMELINE);
    expect(timelines).toHaveLength(2);
    const casos = httpMock.match((r: HttpRequest<unknown>) => r.url === CASOS);
    expect(casos.length).toBeGreaterThan(0);
    for (const pedido of [...timelines, ...casos]) {
      expect(pedido.request.headers.get(HEADER)).toBe('Interconsulta');
    }
    casos.forEach((pedido) => pedido.flush([]));
    responderTimeline(timelines, PAGINA);
    await estabilizar(fixture);
    // Lo que se relee despues (los casos del listado) tambien lleva el motivo.
    for (const pedido of httpMock.match((r: HttpRequest<unknown>) => r.url === CASOS)) {
      expect(pedido.request.headers.get(HEADER)).toBe('Interconsulta');
      pedido.flush([]);
    }
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Prueba, Lucia');
    expect(texto(fixture)).toContain('Con motivo declarado');
    expect(texto(fixture)).toContain('Penicilina');
  });

  it('una persona sin historia ofrece abrirla, y abrirla muestra la historia', async () => {
    const fixture = await montar();
    httpMock
      .expectOne((r) => r.url === HISTORIA_POR_PERSONA && r.method === 'GET')
      .flush(
        { type: 'https://akine.app/problems/not-found', status: 404 },
        { status: 404, statusText: 'NF' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Todavía no tiene historia clínica');

    boton(fixture, 'Abrir la historia clínica').click();
    httpMock.expectOne((r) => r.url === HISTORIA_POR_PERSONA && r.method === 'PUT').flush(HISTORIA);
    await estabilizar(fixture);
    responderTimeline(
      httpMock.match((r) => r.url === TIMELINE),
      { eventos: [] },
    );
    httpMock.match((r) => r.url === CASOS).forEach((r) => r.flush([]));
    await estabilizar(fixture);
    httpMock.match((r) => r.url === CASOS).forEach((r) => r.flush([]));
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Prueba, Lucia');
    expect(texto(fixture)).toContain('Todavía no hay hechos clínicos registrados');
    expect(TestBed.inject(AvisosStore).avisos()[0]?.titulo).toBe('Historia clínica abierta');
  });

  it('sin permiso no ofrece reintentar: no es algo que se resuelva insistiendo', async () => {
    const fixture = await montar();
    httpMock
      .expectOne((r) => r.url === HISTORIA_POR_PERSONA)
      .flush(
        { type: 'https://akine.app/problems/forbidden', status: 403 },
        { status: 403, statusText: 'F' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No tenés permiso para ver historias clínicas');
    expect(botonOpcional(fixture, 'Reintentar')).toBeNull();
  });

  it(
    'con la historia cargada no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      httpMock.expectOne((r) => r.url === HISTORIA_POR_PERSONA).flush(HISTORIA);
      await estabilizar(fixture);
      responderTimeline(
        httpMock.match((r) => r.url === TIMELINE),
        PAGINA,
      );
      httpMock.match((r) => r.url === CASOS).forEach((r) => r.flush([]));
      await estabilizar(fixture);
      httpMock.match((r) => r.url === CASOS).forEach((r) => r.flush([]));
      await estabilizar(fixture);

      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  describe('carga del profesional (hc:write)', () => {
    beforeEach(() => darPermisos(PERMISO_HC_WRITE));

    it('una cirugía viaja con zona, año y lugar, y al guardar se ve con su detalle', async () => {
      const fixture = await abrirLista({ ...HISTORIA, antecedentes: [] });
      expect(texto(fixture)).toContain('Sin antecedentes registrados.');

      botonQueDice(fixture, 'Agregar').click();
      await estabilizar(fixture);
      expect(texto(fixture)).not.toContain('Sin antecedentes registrados.');

      const tipo = enFormulario(fixture, 'app-chips');
      tipo.triggerEventHandler('valorChange', ['QUIRURGICO']); // no es un valor simple: se ignora
      tipo.triggerEventHandler('valorChange', null);
      await estabilizar(fixture);
      expect(enFormulario(fixture, 'app-numero-con-pasos')).toBeNull();
      tipo.triggerEventHandler('valorChange', 'QUIRURGICO');
      await estabilizar(fixture);

      escribir(fixture, '#hc-antecedente-descripcion', '  Meniscectomía  ');
      const zona = fixture.debugElement.queryAll(By.css('form.historia__carga app-chips'))[1];
      zona.triggerEventHandler('valorChange', 'Rodilla');
      await estabilizar(fixture);
      zona.triggerEventHandler('valorChange', null);
      zona.triggerEventHandler('textoOtraChange', '  Rodilla derecha ');
      const anio = enFormulario(fixture, 'app-numero-con-pasos');
      anio.triggerEventHandler('valorChange', null);
      anio.triggerEventHandler('invalido', false);
      anio.triggerEventHandler('valorChange', 2019);
      enFormulario(fixture, 'app-texto-opcional').triggerEventHandler(
        'valorChange',
        ' Hospital Privado ',
      );
      await estabilizar(fixture);
      enviar(fixture);

      const alta = httpMock.expectOne((r) => r.url === ANTECEDENTES && r.method === 'POST');
      expect(alta.request.body).toEqual({
        tipo: 'QUIRURGICO',
        descripcion: 'Meniscectomía',
        zona: 'Rodilla derecha',
        anio: 2019,
        lugar: 'Hospital Privado',
      });
      expect(alta.request.headers.has(HEADER)).toBe(false);
      alta.flush({ id: 9 });
      await estabilizar(fixture);

      httpMock
        .expectOne((r) => r.url === HISTORIA_POR_PERSONA && r.method === 'GET')
        .flush({
          ...HISTORIA,
          antecedentes: [
            {
              id: 9,
              tipo: 'QUIRURGICO',
              descripcion: 'Meniscectomía',
              zona: 'Rodilla derecha',
              anio: 2019,
              lugar: 'Hospital Privado',
            },
          ],
        });
      await drenar(fixture);

      expect(texto(fixture)).toContain('Rodilla derecha · 2019 · Hospital Privado');
      expect(fixture.nativeElement.querySelector('form.historia__carga')).toBeNull();
      expect(ultimoAviso()).toBe('Antecedente agregado');
    });

    it('sin descripción o con un año inválido no guarda, y un 400 se muestra en el formulario', async () => {
      const fixture = await abrirLista();
      botonQueDice(fixture, 'Agregar').click();
      await estabilizar(fixture);

      enviar(fixture);
      await estabilizar(fixture);
      httpMock.expectNone(ANTECEDENTES);
      expect(texto(fixture)).toContain('Escribí la descripción.');
      expect(
        fixture.nativeElement
          .querySelector('#hc-antecedente-descripcion')
          .getAttribute('aria-invalid'),
      ).toBe('true');

      enFormulario(fixture, 'app-chips').triggerEventHandler('valorChange', 'QUIRURGICO');
      await estabilizar(fixture);
      escribir(fixture, '#hc-antecedente-descripcion', 'Artroscopía');
      enFormulario(fixture, 'app-numero-con-pasos').triggerEventHandler('invalido', true);
      enviar(fixture);
      await estabilizar(fixture);
      httpMock.expectNone(ANTECEDENTES);
      expect(texto(fixture)).toContain('Escribí el año con números, por ejemplo 2019.');

      // Corregido el año y vuelta a un tipo sin detalle: la cirugía no viaja.
      enFormulario(fixture, 'app-numero-con-pasos').triggerEventHandler('invalido', false);
      enFormulario(fixture, 'app-numero-con-pasos').triggerEventHandler('valorChange', 2010);
      enFormulario(fixture, 'app-chips').triggerEventHandler('valorChange', 'MEDICO');
      await estabilizar(fixture);
      enviar(fixture);
      const alta = httpMock.expectOne((r) => r.url === ANTECEDENTES && r.method === 'POST');
      expect(alta.request.body).toEqual({ tipo: 'MEDICO', descripcion: 'Artroscopía' });
      enviar(fixture); // en vuelo: no sale un segundo pedido
      httpMock.expectNone((r) => r.url === ANTECEDENTES && r.method === 'POST');
      await estabilizar(fixture);
      expect(texto(fixture)).toContain('Guardando…');
      alta.flush(
        { type: 'https://akine.app/problems/validation-error', status: 400, detail: 'Inválido' },
        { status: 400, statusText: 'Bad Request' },
      );
      await estabilizar(fixture);

      const alerta = fixture.nativeElement.querySelector('#error-antecedente-nuevo');
      expect(alerta?.textContent?.trim()).not.toBe('');
      expect(texto(fixture)).toContain('Guardar antecedente');

      boton(fixture, 'Cancelar').click();
      await estabilizar(fixture);
      expect(fixture.nativeElement.querySelector('form.historia__carga')).toBeNull();
      expect(texto(fixture)).toContain('Penicilina');
    });

    it('el resumen se escribe, un 409 queda en el formulario y al reintentar se guarda', async () => {
      const fixture = await abrirLista({ ...HISTORIA, resumen: undefined });
      expect(texto(fixture)).toContain('Sin resumen cargado.');

      boton(fixture, 'Escribir').click();
      await estabilizar(fixture);
      escribir(fixture, '#hc-resumen', '  Lumbalgia mecánica.  ');
      enviar(fixture);
      const primero = httpMock.expectOne(`${HISTORIA_POR_PERSONA}/resumen`);
      expect(primero.request.body).toEqual({ texto: 'Lumbalgia mecánica.', expectedVersion: 2 });
      enviar(fixture);
      httpMock.expectNone(`${HISTORIA_POR_PERSONA}/resumen`);
      primero.flush(
        { type: 'https://akine.app/problems/concurrent-modification', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
      await estabilizar(fixture);
      expect(
        fixture.nativeElement.querySelector('.historia__resumen [role="alert"]'),
      ).not.toBeNull();

      enviar(fixture);
      httpMock
        .expectOne(`${HISTORIA_POR_PERSONA}/resumen`)
        .flush({ ...HISTORIA, resumen: 'Lumbalgia mecánica.', version: 3 });
      await drenar(fixture);
      expect(texto(fixture)).toContain('Lumbalgia mecánica.');
      expect(ultimoAviso()).toBe('Resumen guardado');

      boton(fixture, 'Editar').click();
      await estabilizar(fixture);
      expect(
        (fixture.nativeElement.querySelector('#hc-resumen') as HTMLTextAreaElement).value,
      ).toBe('Lumbalgia mecánica.');
      boton(fixture, 'Cancelar').click();
      await estabilizar(fixture);
      expect(fixture.nativeElement.querySelector('#hc-resumen')).toBeNull();
    });
  });

  it('la ficha de ingreso y lo declarado se cargan en Datos declarados: la historia enlaza ahí', async () => {
    const fixture = await abrirLista();
    const enlace = (fixture.nativeElement as HTMLElement).querySelector(
      '.historia__declarados-enlace a',
    ) as HTMLAnchorElement;
    expect(enlace.textContent).toContain('Ficha de ingreso y datos declarados');
    expect(enlace.getAttribute('href')).toBe(`/pacientes/${PERSONA}/datos-declarados`);
  });

  describe('detalle de lo elegido en el timeline', () => {
    it('muestra el antecedente vigente, avisa si ya no lo está, y la sesión enlaza a la atención', async () => {
      darPermisos();
      const fixture = await abrirLista({
        ...HISTORIA,
        antecedentes: [
          {
            id: 5,
            tipo: 'QUIRURGICO',
            descripcion: 'Hombro',
            zona: 'Hombro',
            anio: 2020,
            vigente: true,
          },
        ],
      });

      elegirEvento(fixture, { origen: 'ANTECEDENTE_CLINICO', referencia: 5 });
      await estabilizar(fixture);
      expect(textoDetalle(fixture)).toContain('Hombro · 2020');

      elegirEvento(fixture, { origen: 'ANTECEDENTE_CLINICO', referencia: 99 });
      await estabilizar(fixture);
      expect(textoDetalle(fixture)).toContain('ya no esta vigente');

      elegirEvento(fixture, { origen: 'SESION', referencia: 501 });
      await estabilizar(fixture);
      const enlace = fixture.nativeElement.querySelector(
        '[aria-labelledby="titulo-detalle"] a',
      ) as HTMLAnchorElement;
      expect(enlace.getAttribute('href')).toBe('/atencion/sesiones/501');

      boton(fixture, 'Cerrar el detalle').click();
      await estabilizar(fixture);
      expect(fixture.nativeElement.querySelector('#titulo-detalle')).toBeNull();
    });

    it('un adjunto declarado muestra su marca junto al visor', async () => {
      darPermisos(PERMISO_HC_DECLARAR);
      const fixture = await abrirLista(HISTORIA, {
        declarados: { adjuntos: [{ id: 32, origen: 'DECLARADO', revisadoEn: 'x' }] },
      });

      elegirEvento(fixture, { origen: 'ADJUNTO_CLINICO', referencia: 32 });
      await drenar(fixture);
      expect(textoDetalle(fixture)).toContain('Declarado');

      elegirEvento(fixture, { origen: 'ADJUNTO_CLINICO', referencia: 40 });
      await drenar(fixture);
      expect(textoDetalle(fixture)).not.toContain('Declarado');
    });
  });

  describe('errores de la carga', () => {
    it('un id de persona inválido es "no encontrado", sin pedir nada', async () => {
      const fixture = TestBed.createComponent(HistoriaClinicaPage);
      TestBed.inject(VisitaClinica).iniciar(-3);
      await estabilizar(fixture);
      httpMock.expectNone((r) => r.url === HISTORIA_POR_PERSONA);
      expect(fixture.nativeElement.querySelector('app-alerta')).not.toBeNull();
      boton(fixture, 'Reintentar').click();
      httpMock.expectNone((r) => r.url === HISTORIA_POR_PERSONA);
    });

    it('un error del servidor ofrece reintentar, y reintentar vuelve a pedir', async () => {
      const fixture = await montar();
      httpMock
        .expectOne((r) => r.url === HISTORIA_POR_PERSONA)
        .flush({ status: 500 }, { status: 500, statusText: 'Error' });
      await estabilizar(fixture);
      boton(fixture, 'Reintentar').click();
      await responderCarga(fixture, HISTORIA, {});
      expect(texto(fixture)).toContain('Penicilina');
    });

    it('abrir la historia: si pide motivo lo pide, y otro error se muestra sin salir', async () => {
      const fixture = await montar();
      httpMock
        .expectOne((r) => r.url === HISTORIA_POR_PERSONA)
        .flush(
          { type: 'https://akine.app/problems/not-found', status: 404 },
          { status: 404, statusText: 'NF' },
        );
      await estabilizar(fixture);

      boton(fixture, 'Abrir la historia clínica').click();
      await estabilizar(fixture);
      expect(texto(fixture)).toContain('Abriendo…');
      httpMock
        .expectOne((r) => r.url === HISTORIA_POR_PERSONA && r.method === 'PUT')
        .flush({ status: 500 }, { status: 500, statusText: 'Error' });
      await estabilizar(fixture);
      expect(texto(fixture)).toContain('No pudimos abrir la historia clínica');
      expect(texto(fixture)).toContain('Todavía no tiene historia clínica');

      boton(fixture, 'Abrir la historia clínica').click();
      httpMock
        .expectOne((r) => r.url === HISTORIA_POR_PERSONA && r.method === 'PUT')
        .flush(SIN_RELACION, { status: 403, statusText: 'Forbidden' });
      await estabilizar(fixture);
      expect(texto(fixture)).toContain('Declará el motivo del acceso');
    });
  });

  const DECLARADOS = `/api/v1/personas/${PERSONA}/datos-declarados`;
  const ANTECEDENTES = `${HISTORIA_POR_PERSONA}/antecedentes`;

  interface OpcionesDeCarga {
    declarados?: object | 'error';
  }

  function darPermisos(...permisos: string[]): void {
    vi.spyOn(TestBed.inject(PermissionsStore), 'tiene').mockImplementation((p) =>
      permisos.includes(p),
    );
  }

  async function abrirLista(
    historia: object = HISTORIA,
    opciones: OpcionesDeCarga = {},
  ): Promise<ComponentFixture<HistoriaClinicaPage>> {
    const fixture = await montar();
    await responderCarga(fixture, historia, opciones);
    return fixture;
  }

  /** Contesta la lectura de la historia y lo que se pide a partir de ella. */
  async function responderCarga(
    fixture: ComponentFixture<HistoriaClinicaPage>,
    historia: object,
    opciones: OpcionesDeCarga,
  ): Promise<void> {
    httpMock.expectOne((r) => r.url === HISTORIA_POR_PERSONA && r.method === 'GET').flush(historia);
    const fallar = (r: TestRequest) =>
      r.flush({ status: 500 }, { status: 500, statusText: 'Error' });
    for (const r of httpMock.match((r) => r.url === DECLARADOS && r.method === 'GET')) {
      if (opciones.declarados === 'error') fallar(r);
      else r.flush(opciones.declarados ?? {});
    }
    await drenar(fixture);
  }

  /** Lo accesorio de la pantalla (timeline, casos, ofertas, visor): vacío o caído. */
  async function drenar(fixture: ComponentFixture<HistoriaClinicaPage>): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await estabilizar(fixture);
      httpMock.match((r) => r.url === TIMELINE).forEach((r) => r.flush({ eventos: [] }));
      httpMock.match((r) => r.url === CASOS).forEach((r) => r.flush([]));
      httpMock.match((r) => r.url.endsWith('/ofertas')).forEach((r) => r.flush([]));
      httpMock
        .match((r) => r.url.endsWith('/me/permissions'))
        .forEach((r) => r.flush({ permissions: [] }));
      httpMock
        .match((r) => r.method === 'GET' && /\/adjuntos\/\d+/.test(r.url))
        .forEach((r) => r.error(new ProgressEvent('error')));
    }
    await estabilizar(fixture);
  }

  function elegirEvento(
    fixture: ComponentFixture<HistoriaClinicaPage>,
    evento: { origen: string; referencia: number },
  ): void {
    fixture.debugElement
      .query(By.directive(TimelineClinico))
      .triggerEventHandler('elegido', { ...evento, ocurrioEn: '2026-09-10T15:00:00Z' });
  }

  function textoDetalle(fixture: ComponentFixture<HistoriaClinicaPage>): string {
    return (
      (fixture.nativeElement as HTMLElement).querySelector('[aria-labelledby="titulo-detalle"]')
        ?.textContent ?? ''
    );
  }

  function enFormulario(fixture: ComponentFixture<HistoriaClinicaPage>, selector: string) {
    return fixture.debugElement.query(By.css(`form.historia__carga ${selector}`));
  }

  function escribir(
    fixture: ComponentFixture<HistoriaClinicaPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = (fixture.nativeElement as HTMLElement).querySelector(selector) as
      HTMLTextAreaElement | HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
  }

  function enviar(fixture: ComponentFixture<HistoriaClinicaPage>): void {
    (fixture.nativeElement as HTMLElement)
      .querySelector('form.historia__carga')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
  }

  function botonQueDice(
    fixture: ComponentFixture<HistoriaClinicaPage>,
    rotulo: string,
  ): HTMLButtonElement {
    const botones = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    const normal = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
    const encontrado = Array.from(botones).find((b) => normal(b.textContent) === rotulo);
    if (!encontrado) {
      throw new Error(`No hay botón "${rotulo}"`);
    }
    return encontrado;
  }

  function ultimoAviso(): string | undefined {
    const avisos = TestBed.inject(AvisosStore).avisos();
    return avisos[avisos.length - 1]?.titulo;
  }

  async function montar(): Promise<ComponentFixture<HistoriaClinicaPage>> {
    const fixture = TestBed.createComponent(HistoriaClinicaPage);
    TestBed.inject(VisitaClinica).iniciar(PERSONA);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  /**
   * Contesta las lecturas del timeline: la del timeline completo con `pagina`, y la de la lista de
   * sesiones (filtrada por origen `SESION`) vacía.
   */
  function responderTimeline(pedidos: TestRequest[], pagina: object): void {
    expect(pedidos).toHaveLength(2);
    for (const pedido of pedidos) {
      pedido.flush(pedido.request.params.has('origen') ? { eventos: [] } : pagina);
    }
  }

  async function estabilizar(fixture: ComponentFixture<HistoriaClinicaPage>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<HistoriaClinicaPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function botonOpcional(
    fixture: ComponentFixture<HistoriaClinicaPage>,
    rotulo: string,
  ): HTMLButtonElement | null {
    const botones = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    return Array.from(botones).find((b) => b.textContent?.trim() === rotulo) ?? null;
  }

  function boton(
    fixture: ComponentFixture<HistoriaClinicaPage>,
    rotulo: string,
  ): HTMLButtonElement {
    const encontrado = botonOpcional(fixture, rotulo);
    if (encontrado === null) {
      throw new Error(`No hay botón "${rotulo}"`);
    }
    return encontrado;
  }

  function enviarMotivo(fixture: ComponentFixture<HistoriaClinicaPage>, motivo: string): void {
    const raiz = fixture.nativeElement as HTMLElement;
    const campo = raiz.querySelector('#motivo-acceso') as HTMLInputElement;
    campo.value = motivo;
    campo.dispatchEvent(new Event('input'));
    boton(fixture, 'Ver la historia clínica').click();
    fixture.detectChanges();
  }
});
