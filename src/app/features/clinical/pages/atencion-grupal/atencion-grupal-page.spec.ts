import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { AtencionGrupalPage } from './atencion-grupal-page';
import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { AvisosStore } from '../../../../core/services/avisos.store';

const CONSULTORIO = 3;
const CLASE = 40;
const BASE = `/api/v1/consultorios/${CONSULTORIO}/clases/${CLASE}`;
const PANEL = `${BASE}/atencion-clinica`;
const LOTE = `${BASE}/atencion-clinica/lote`;
const MARIA = 71;
const JUAN = 72;
const ANA = 73;
const atencionDe = (inscripcion: number) => `${BASE}/inscripciones/${inscripcion}/atencion-clinica`;
const derivacionesDe = (inscripcion: number) => `${BASE}/inscripciones/${inscripcion}/derivaciones`;
const elegibilidadDe = (inscripcion: number) =>
  `${BASE}/inscripciones/${inscripcion}/elegibilidad-clinica`;
const DATOS_DE_MARIA = '/api/v1/historias-clinicas/por-persona/501/datos-administrativos';
const MARIA_DERIVABLE = {
  inscripcionId: MARIA,
  personaId: 501,
  derivable: true,
  ofertaClinica: true,
  esPacienteVigente: true,
  resultadoAsistencia: 'PRESENTE',
  motivos: [],
};
const UN_CASO_DE_MARIA = {
  personaId: 501,
  tieneHistoriaClinica: true,
  casos: [{ id: 7, numeroCaso: 1, estado: 'ACTIVO', abiertoEn: '2026-09-01T13:00:00Z' }],
};

/** Maria estuvo y no tiene atencion; Juan estuvo y tiene una cerrada; Ana falto. */
const PANEL_CLINICO = {
  claseId: CLASE,
  clinica: true,
  participantes: [
    {
      inscripcionId: MARIA,
      asistenciaId: 1,
      personaId: 501,
      nombre: 'Maria',
      apellido: 'Sintetica',
      estuvo: true,
      resultadoAsistencia: 'PRESENTE',
    },
    {
      inscripcionId: JUAN,
      asistenciaId: 2,
      personaId: 502,
      nombre: 'Juan',
      apellido: 'Sintetico',
      estuvo: true,
      resultadoAsistencia: 'PRESENTE_TARDE',
      atenciones: [
        {
          sesionId: 901,
          derivacionId: 31,
          estado: 'CERRADA',
          numeroEnCaso: 3,
          numeroSesion: 8,
        },
      ],
    },
    {
      inscripcionId: ANA,
      asistenciaId: 3,
      personaId: 503,
      nombre: 'Ana',
      apellido: 'Sintetica',
      estuvo: false,
      resultadoAsistencia: 'AUSENTE',
    },
  ],
};

/** La clase: titulo y horario. Los nombres ya vienen en el panel (contrato 0.118.0). */
const CLASE_LEIDA = {
  id: CLASE,
  titulo: 'Rehabilitacion de rodilla',
  ofertaNombre: 'Kinesiologia grupal',
  inicio: '2026-10-20T13:00:00Z',
};
const esLaClase = (r: { url: string; method: string }) => r.method === 'GET' && r.url === BASE;

const ABIERTA = { sesionId: 900, derivacionId: 30, estado: 'BORRADOR', inscripcionId: MARIA };

/**
 * Spec del panel de atencion clinica de una clase (AKINE-08.05).
 *
 * <p>Lo que decide comportamiento: que se abre una atencion por participante y se va a ella, que
 * la pantalla nunca elige entre dos derivaciones, que el lote muestra quien fallo y por que, que el
 * motivo de acceso se pide y se reenvia, y que revertir una derivacion con atencion se explica.
 */
describe('AtencionGrupalPage', () => {
  let http: HttpTestingController;
  let navegar: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AtencionGrupalPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
    // Los permisos de la PROFESIONAL: derivar (hc:write) se ofrece solo con ellos.
    TestBed.inject(PermissionsStore).cargar().subscribe();
    http.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({
      permissions: ['sesion:register', 'inscripcion:read', 'hc:read', 'hc:write', 'paciente:read'],
    });
  });

  afterEach(() => http.verify());

  it('lista quien estuvo, su asistencia y sus atenciones, con nombre y enlace a la atención', async () => {
    const fixture = await montar();
    const tabla = texto(fixture);
    expect(tabla).toContain('Rehabilitacion de rodilla');
    expect(tabla).toContain('Sintetica, Maria');
    expect(tabla).toContain('Llego tarde');
    expect(tabla).toContain('Atención cerrada · sesión 3 del caso · sesión 8 del paciente');
    const enlace = fixture.nativeElement.querySelector(
      'a[href="/atencion/sesiones/901"]',
    ) as HTMLAnchorElement | null;
    expect(enlace).not.toBeNull();
    // Solo Maria: Juan ya tiene atencion y Ana no estuvo.
    expect(botones(fixture, /^Iniciar atención/)).toHaveLength(1);
    expect(boton(fixture, /Iniciar para todos/).textContent).toContain('(1)');
  });

  it('los nombres salen del panel: no pide el detalle operativo de la asistencia', async () => {
    const fixture = await montar();
    http.expectNone((r) => r.url.endsWith('/detalle-operativo'));
    expect(texto(fixture)).toContain('Sintetico, Juan');
  });

  it('sin nombre resuelto muestra un texto neutro, nunca el id', async () => {
    const fixture = TestBed.createComponent(AtencionGrupalPage);
    fixture.componentRef.setInput('claseId', String(CLASE));
    fixture.detectChanges();
    http.expectOne(PANEL).flush({
      ...PANEL_CLINICO,
      participantes: [{ inscripcionId: MARIA, personaId: 501, estuvo: true }],
    });
    // Sin la clase el panel se sigue usando: el titulo cae a "Clase N".
    http
      .expectOne(esLaClase)
      .flush({ type: 'x', status: 403 }, { status: 403, statusText: 'Forbidden' });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Participante sin nombre');
    expect(texto(fixture)).not.toContain(String(MARIA));
    expect(texto(fixture)).not.toContain('501');
    expect(texto(fixture)).toContain(`Atención clínica: Clase ${CLASE}`);
  });

  it('una clase sin titulo se llama como su oferta', async () => {
    const fixture = TestBed.createComponent(AtencionGrupalPage);
    fixture.componentRef.setInput('claseId', String(CLASE));
    fixture.detectChanges();
    http.expectOne(PANEL).flush(PANEL_CLINICO);
    http.expectOne(esLaClase).flush({ ...CLASE_LEIDA, titulo: undefined });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Atención clínica: Kinesiologia grupal');
  });

  it('iniciar la atención de un participante la abre y lleva a ella', async () => {
    const fixture = await montar();
    boton(fixture, /^Iniciar atención/).click();
    const pedido = http.expectOne(atencionDe(MARIA));
    expect(pedido.request.method).toBe('POST');
    expect(pedido.request.body).toEqual({});
    expect(pedido.request.headers.has('X-Justificacion-Acceso')).toBe(false);
    pedido.flush(ABIERTA, { status: 201, statusText: 'Created' });
    await estabilizar(fixture);
    expect(navegar).toHaveBeenCalledWith('/atencion/sesiones/900');
  });

  it('con dos derivaciones no elige: lo dice, muestra las dos y abre desde la elegida', async () => {
    const fixture = await montar();
    boton(fixture, /^Iniciar atención/).click();
    problema(http.expectOne(atencionDe(MARIA)), 409, 'derivacion-ambigua', {
      derivacionIds: [30, 32],
    });
    http.expectOne(derivacionesDe(MARIA)).flush({
      derivaciones: [
        { id: 30, casoClinicoId: 7, numeroCaso: 1, estado: 'VIGENTE' },
        { id: 32, casoClinicoId: 8, estado: 'VIGENTE' },
      ],
    });
    responderRecarga();
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('más de una derivación vigente');
    // El numero visible del caso, no el id; sin numero, un texto neutro.
    expect(texto(fixture)).toContain('Caso clínico 1');
    expect(texto(fixture)).toContain('Caso clínico sin número');
    expect(texto(fixture)).not.toContain('Caso clínico 7');
    expect(texto(fixture)).not.toContain('Caso clínico 8');
    expect(navegar).not.toHaveBeenCalled();

    botones(fixture, /Iniciar atención desde esta derivación/)[1].click();
    const pedido = http.expectOne(atencionDe(MARIA));
    expect(pedido.request.body).toEqual({ derivacionId: 32 });
    pedido.flush({ ...ABIERTA, sesionId: 902, derivacionId: 32 });
    await estabilizar(fixture);
    expect(navegar).toHaveBeenCalledWith('/atencion/sesiones/902');
  });

  it('sin derivacion lo dice con su texto propio, y no navega', async () => {
    const fixture = await montar();
    boton(fixture, /^Iniciar atención/).click();
    problema(http.expectOne(atencionDe(MARIA)), 409, 'participacion-sin-derivacion');
    // La salida es derivarla: la tarjeta se abre ahi mismo.
    responderRecarga();
    await estabilizar(fixture);
    http.expectOne(elegibilidadDe(MARIA)).flush(MARIA_DERIVABLE);
    http.expectOne(DATOS_DE_MARIA).flush(UN_CASO_DE_MARIA);
    await estabilizar(fixture);
    expect(alerta(fixture)).toContain('No tiene una derivación clínica vigente');
    expect(texto(fixture)).toContain('Derivar a Sintetica, Maria a un caso clínico');
    expect(navegar).not.toHaveBeenCalled();
  });

  it('derivar por pantalla: elige el caso, avisa, marca la fila y deja iniciar la atención', async () => {
    const fixture = await montar();
    // Juan y Maria estuvieron; Ana no: solo a quien estuvo se lo deriva.
    expect(botones(fixture, /^Derivar a un caso/)).toHaveLength(2);
    botones(fixture, /^Derivar a un caso/)[0].click();
    fixture.detectChanges();
    http.expectOne(elegibilidadDe(MARIA)).flush(MARIA_DERIVABLE);
    http.expectOne(DATOS_DE_MARIA).flush(UN_CASO_DE_MARIA);
    await estabilizar(fixture);

    boton(fixture, /^Derivar al caso/).click();
    const derivar = http.expectOne((r) => r.method === 'POST' && r.url === derivacionesDe(MARIA));
    expect(derivar.request.body).toEqual({ casoClinicoId: 7 });
    derivar.flush({ id: 30, casoClinicoId: 7, numeroCaso: 1, estado: 'VIGENTE' });
    responderRecarga();
    await estabilizar(fixture);

    // UX-12: el resultado es un aviso global.
    expect(TestBed.inject(AvisosStore).avisos()[0]?.descripcion).toBe(
      'Sintetica, Maria quedo derivada al caso clínico 1. Ya se puede iniciar su atención.',
    );
    expect(texto(fixture)).toContain('Derivada al caso clínico 1');
    expect(texto(fixture)).not.toContain('Derivar a Sintetica, Maria a un caso clínico');
    boton(fixture, /^Iniciar atención/).click();
    http.expectOne(atencionDe(MARIA)).flush(ABIERTA);
    await estabilizar(fixture);
    expect(navegar).toHaveBeenCalledWith('/atencion/sesiones/900');
  });

  it('sin hc:write no ofrece derivar: el backend lo rechazaria', async () => {
    TestBed.inject(PermissionsStore).cargar().subscribe();
    http
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({ permissions: ['sesion:register', 'inscripcion:read', 'hc:read'] });
    const fixture = await montar();
    expect(botones(fixture, /^Derivar a un caso/)).toHaveLength(0);
    expect(botones(fixture, /^Iniciar atención/)).toHaveLength(1);
  });

  it('derivar dos veces al mismo caso dice que ya estaba derivada', async () => {
    const fixture = await montar();
    botones(fixture, /^Derivar a un caso/)[0].click();
    fixture.detectChanges();
    http.expectOne(elegibilidadDe(MARIA)).flush(MARIA_DERIVABLE);
    http.expectOne(DATOS_DE_MARIA).flush(UN_CASO_DE_MARIA);
    await estabilizar(fixture);
    boton(fixture, /^Derivar al caso/).click();
    http
      .expectOne((r) => r.method === 'POST' && r.url === derivacionesDe(MARIA))
      .flush({ id: 30, casoClinicoId: 7, numeroCaso: 1, estado: 'VIGENTE', yaExistia: true });
    responderRecarga();
    await estabilizar(fixture);
    expect(TestBed.inject(AvisosStore).avisos()[0]?.descripcion).toContain(
      'ya estaba derivada al caso clínico 1',
    );
  });

  it('derivar sin relación asistencial pide el motivo en el panel y reintenta con el', async () => {
    const fixture = await montar();
    botones(fixture, /^Derivar a un caso/)[0].click();
    fixture.detectChanges();
    http.expectOne(elegibilidadDe(MARIA)).flush(MARIA_DERIVABLE);
    http.expectOne(DATOS_DE_MARIA).flush(UN_CASO_DE_MARIA);
    await estabilizar(fixture);
    boton(fixture, /^Derivar al caso/).click();
    problema(
      http.expectOne((r) => r.method === 'POST' && r.url === derivacionesDe(MARIA)),
      403,
      'justificacion-de-acceso-requerida',
    );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Declara el motivo del acceso');

    escribir(fixture, '#motivo-acceso-grupal', 'Cubro a la profesional');
    boton(fixture, /Declarar y seguir/).click();
    const reintento = http.expectOne((r) => r.method === 'POST' && r.url === derivacionesDe(MARIA));
    expect(reintento.request.headers.get('X-Justificacion-Acceso')).toBe('Cubro a la profesional');
    reintento.flush({ id: 30, casoClinicoId: 7, numeroCaso: 1, estado: 'VIGENTE' });
    responderRecarga();
    await estabilizar(fixture);
    expect(TestBed.inject(AvisosStore).avisos()[0]?.descripcion).toContain(
      'quedo derivada al caso clínico 1',
    );
  });

  it('sin derivaciones, la tarjeta de derivaciones ofrece derivar', async () => {
    const fixture = await montar();
    botones(fixture, /^Derivaciones/)[0].click();
    http.expectOne(derivacionesDe(MARIA)).flush({ derivaciones: [] });
    await estabilizar(fixture);
    boton(fixture, /^Derivar a un caso$/).click();
    fixture.detectChanges();
    http.expectOne(elegibilidadDe(MARIA)).flush(MARIA_DERIVABLE);
    http.expectOne(DATOS_DE_MARIA).flush(UN_CASO_DE_MARIA);
    await estabilizar(fixture);
    // Se abre una y se cierra la otra.
    expect(fixture.nativeElement.querySelector('#titulo-derivaciones')).toBeNull();
    boton(fixture, /^Cerrar$/).click();
    await estabilizar(fixture);
    expect(botones(fixture, /^Derivar al caso/)).toHaveLength(0);
  });

  it('el lote muestra cuantas se abrieron y quien fallo con su causa', async () => {
    const fixture = await montar({
      ...PANEL_CLINICO,
      participantes: PANEL_CLINICO.participantes.map((p) =>
        p.inscripcionId === ANA ? { ...p, estuvo: true, resultadoAsistencia: 'PRESENTE' } : p,
      ),
    });
    boton(fixture, /Iniciar para todos/).click();
    const pedido = http.expectOne(LOTE);
    expect(pedido.request.body).toEqual({
      items: [{ inscripcionId: MARIA }, { inscripcionId: ANA }],
    });
    pedido.flush({
      exitosos: 1,
      fallidos: 1,
      items: [
        { inscripcionId: MARIA, atencion: ABIERTA },
        {
          inscripcionId: ANA,
          problemType: 'https://akine.app/problems/participacion-sin-derivacion',
          detalle: 'sin derivacion',
        },
      ],
    });
    responderRecarga();
    await estabilizar(fixture);
    const resultado = texto(fixture);
    expect(resultado).toContain('Se abrieron 1 atención.');
    expect(resultado).toContain('1 no se pudieron abrir');
    // Ademas del detalle en pantalla, el resultado se anuncia: advertencia porque alguna fallo.
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.tipo).toBe('advertencia');
    expect(aviso?.titulo).toBe('Se abrió 1 atención');
    expect(resultado).toMatch(/Sintetica, Ana\s*: No tiene una derivación clínica vigente/);
    expect(navegar).not.toHaveBeenCalled();
  });

  it('un fallo derivacion-ambigua del lote se resuelve ahi mismo, sin iniciar de a uno', async () => {
    const fixture = await montar({
      ...PANEL_CLINICO,
      participantes: PANEL_CLINICO.participantes.map((p) =>
        p.inscripcionId === ANA ? { ...p, estuvo: true, resultadoAsistencia: 'PRESENTE' } : p,
      ),
    });
    boton(fixture, /Iniciar para todos/).click();
    http.expectOne(LOTE).flush({
      exitosos: 1,
      fallidos: 1,
      items: [
        { inscripcionId: MARIA, atencion: ABIERTA },
        {
          inscripcionId: ANA,
          problemType: 'https://akine.app/problems/derivacion-ambigua',
          derivacionIds: [40, 42],
        },
      ],
    });
    responderRecarga();
    await estabilizar(fixture);
    expect(texto(fixture)).toMatch(/Sintetica, Ana\s*: Tiene más de una derivación vigente/);
    // La lectura de derivaciones es clinica: no se hace hasta que alguien elige.
    http.expectNone(derivacionesDe(ANA));

    boton(fixture, /^Elegir la derivación/).click();
    http.expectOne(derivacionesDe(ANA)).flush({
      derivaciones: [
        { id: 40, casoClinicoId: 17, numeroCaso: 2, estado: 'VIGENTE' },
        { id: 41, casoClinicoId: 18, numeroCaso: 3, estado: 'REVERTIDA' },
        { id: 42, casoClinicoId: 19, numeroCaso: 4, estado: 'VIGENTE' },
      ],
    });
    await estabilizar(fixture);
    // Solo las que el backend ofrecio, y en el resultado: la tarjeta de abajo no se abre.
    expect(botones(fixture, /^Iniciar desde:/).map((b) => b.textContent?.trim())).toHaveLength(2);
    expect(texto(fixture)).toContain('Iniciar desde: Caso clínico 2');
    expect(texto(fixture)).toContain('Iniciar desde: Caso clínico 4');
    expect(texto(fixture)).not.toContain('Caso clínico 3');
    expect(fixture.nativeElement.querySelector('#titulo-derivaciones')).toBeNull();

    botones(fixture, /^Iniciar desde: Caso clínico 4/)[0].click();
    const pedido = http.expectOne(atencionDe(ANA));
    expect(pedido.request.body).toEqual({ derivacionId: 42 });
    pedido.flush({ ...ABIERTA, sesionId: 903, derivacionId: 42, inscripcionId: ANA });
    responderRecarga();
    await estabilizar(fixture);
    // No navega: el resultado del lote se actualiza en su lugar.
    expect(navegar).not.toHaveBeenCalled();
    expect(texto(fixture)).toContain('Se abrieron 2 atenciones.');
    expect(texto(fixture)).not.toContain('no se pudieron abrir');
  });

  it('elegir en el lote se puede postergar, y un error de inicio se muestra ahi', async () => {
    const fixture = await montar();
    boton(fixture, /Iniciar para todos/).click();
    http.expectOne(LOTE).flush({
      exitosos: 0,
      fallidos: 1,
      items: [
        {
          inscripcionId: MARIA,
          problemType: 'https://akine.app/problems/derivacion-ambigua',
          derivacionIds: [30, 32],
        },
      ],
    });
    responderRecarga();
    await estabilizar(fixture);
    boton(fixture, /^Elegir la derivación/).click();
    http.expectOne(derivacionesDe(MARIA)).flush({
      derivaciones: [
        { id: 30, numeroCaso: 1, estado: 'VIGENTE' },
        { id: 32, numeroCaso: 2, estado: 'VIGENTE' },
      ],
    });
    await estabilizar(fixture);
    boton(fixture, /^Iniciar desde: Caso clínico 1/).click();
    problema(http.expectOne(atencionDe(MARIA)), 409, 'caso-clinico-cerrado');
    await estabilizar(fixture);
    expect(alerta(fixture)).toContain('caso');
    expect(texto(fixture)).toContain('1 no se pudieron abrir');

    boton(fixture, /^No elegir ahora/).click();
    await estabilizar(fixture);
    expect(botones(fixture, /^Iniciar desde:/)).toHaveLength(0);
    expect(botones(fixture, /^Elegir la derivación/)).toHaveLength(1);
  });

  it('si ninguna de las ofrecidas sigue vigente lo dice', async () => {
    const fixture = await montar();
    boton(fixture, /Iniciar para todos/).click();
    http.expectOne(LOTE).flush({
      exitosos: 0,
      fallidos: 1,
      items: [
        {
          inscripcionId: MARIA,
          problemType: 'https://akine.app/problems/derivacion-ambigua',
          derivacionIds: [30, 32],
        },
      ],
    });
    responderRecarga();
    await estabilizar(fixture);
    boton(fixture, /^Elegir la derivación/).click();
    http.expectOne(derivacionesDe(MARIA)).flush({
      derivaciones: [{ id: 30, numeroCaso: 1, estado: 'REVERTIDA' }],
    });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Ya no tiene vigente ninguna de las derivaciones ofrecidas');
  });

  it('si el backend pide motivo de acceso lo pide en pantalla y reintenta con el', async () => {
    const fixture = await montar();
    boton(fixture, /^Iniciar atención/).click();
    problema(http.expectOne(atencionDe(MARIA)), 403, 'justificacion-de-acceso-requerida');
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Declara el motivo del acceso');

    // Sin motivo no sale nada.
    boton(fixture, /Declarar y seguir/).click();
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Sin motivo no se puede seguir.');
    http.expectNone(atencionDe(MARIA));

    escribir(fixture, '#motivo-acceso-grupal', 'Interconsulta de prueba');
    boton(fixture, /Declarar y seguir/).click();
    const reintento = http.expectOne(atencionDe(MARIA));
    expect(reintento.request.headers.get('X-Justificacion-Acceso')).toBe('Interconsulta de prueba');
    reintento.flush(ABIERTA);
    await estabilizar(fixture);
    expect(navegar).toHaveBeenCalledWith('/atencion/sesiones/900');
  });

  it('el lote que pide motivo lo pide y reintenta el lote', async () => {
    const fixture = await montar();
    boton(fixture, /Iniciar para todos/).click();
    http.expectOne(LOTE).flush({
      exitosos: 0,
      fallidos: 1,
      items: [
        {
          inscripcionId: MARIA,
          problemType: 'https://akine.app/problems/justificacion-de-acceso-requerida',
        },
      ],
    });
    responderRecarga();
    await estabilizar(fixture);
    escribir(fixture, '#motivo-acceso-grupal', 'Supervision');
    boton(fixture, /Declarar y seguir/).click();
    const reintento = http.expectOne(LOTE);
    expect(reintento.request.headers.get('X-Justificacion-Acceso')).toBe('Supervision');
    reintento.flush({
      exitosos: 1,
      fallidos: 0,
      items: [{ inscripcionId: MARIA, atencion: ABIERTA }],
    });
    responderRecarga();
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Se abrieron 1 atención.');
  });

  describe('revertir una derivacion', () => {
    async function conDerivaciones(
      lista: object[],
      inscripcion = MARIA,
    ): Promise<ComponentFixture<AtencionGrupalPage>> {
      const fixture = await montar();
      const indice = inscripcion === MARIA ? 0 : 1;
      botones(fixture, /^Derivaciones/)[indice].click();
      http.expectOne(derivacionesDe(inscripcion)).flush({ derivaciones: lista });
      await estabilizar(fixture);
      return fixture;
    }

    it('pide motivo, y con 409 derivacion-con-sesion explica que la atención la fija', async () => {
      const fixture = await conDerivaciones([{ id: 30, casoClinicoId: 7, estado: 'VIGENTE' }]);
      boton(fixture, /^Revertir la derivación/).click();
      await estabilizar(fixture);
      boton(fixture, /Confirmar la reversión/).click();
      await estabilizar(fixture);
      expect(texto(fixture)).toContain('Escribí por qué se revierte.');
      http.expectNone(`${derivacionesDe(MARIA)}/30/reversion`);

      escribir(fixture, '#motivo-reversion-30', 'Derivada por error');
      boton(fixture, /Confirmar la reversión/).click();
      const pedido = http.expectOne(`${derivacionesDe(MARIA)}/30/reversion`);
      expect(pedido.request.body).toEqual({ motivo: 'Derivada por error' });
      problema(pedido, 409, 'derivacion-con-sesion');
      await estabilizar(fixture);
      expect(alerta(fixture)).toContain('ya se abrió una atención clínica desde ella');
    });

    it('revertida, relee las derivaciones y el panel, y lo confirma', async () => {
      const fixture = await conDerivaciones([{ id: 30, casoClinicoId: 7, estado: 'VIGENTE' }]);
      boton(fixture, /^Revertir la derivación/).click();
      await estabilizar(fixture);
      escribir(fixture, '#motivo-reversion-30', 'Derivada por error');
      boton(fixture, /Confirmar la reversión/).click();
      http
        .expectOne(`${derivacionesDe(MARIA)}/30/reversion`)
        .flush({ id: 30, estado: 'REVERTIDA' });
      http.expectOne(derivacionesDe(MARIA)).flush({
        derivaciones: [
          { id: 30, casoClinicoId: 7, estado: 'REVERTIDA', motivoReversion: 'Derivada por error' },
        ],
      });
      responderRecarga();
      await estabilizar(fixture);
      expect(texto(fixture)).toContain('Derivacion revertida.');
      expect(texto(fixture)).toContain('Motivo de la reversión: Derivada por error');
      expect(botones(fixture, /^Revertir la derivación/)).toHaveLength(0);
    });

    it('con la atención abierta desde la derivacion no ofrece revertir y dice por que', async () => {
      const fixture = await conDerivaciones(
        [{ id: 31, casoClinicoId: 7, estado: 'VIGENTE' }],
        JUAN,
      );
      expect(texto(fixture)).toContain('la derivación no se puede revertir');
      expect(botones(fixture, /^Revertir la derivación/)).toHaveLength(0);
    });

    it('el foco va al panel, al motivo y de vuelta al botón que abrio cada cosa', async () => {
      const fixture = await montar();
      // "Derivaciones" vive en el menu "⋯" de la fila (decidido el 22/10/2026): se abre el menu y
      // se elige. Elegir cierra el menu y esconde el item, asi que el foco que se devuelve al
      // cerrar el panel es el del boton "⋯", que es lo que quedo a la vista de la fila.
      const menu = botones(fixture, /^Más acciones de/)[0];
      menu.click();
      await estabilizar(fixture);
      const abrio = botones(fixture, /^Derivaciones/)[0];
      abrio.focus();
      abrio.click();
      http
        .expectOne(derivacionesDe(MARIA))
        .flush({ derivaciones: [{ id: 30, casoClinicoId: 7, estado: 'VIGENTE' }] });
      await estabilizar(fixture);
      // Las derivaciones se abren en un panel lateral, fuera de la tabla: el foco entra al panel.
      expect(document.activeElement?.closest('dialog.panel-lateral')).not.toBeNull();
      expect(document.activeElement?.closest('table')).toBeNull();

      boton(fixture, /^Revertir la derivación/).click();
      await estabilizar(fixture);
      expect(document.activeElement?.id).toBe('motivo-reversion-30');

      // Confirmar sin motivo devuelve el foco al campo que falta.
      boton(fixture, /Confirmar la reversión/).focus();
      boton(fixture, /Confirmar la reversión/).click();
      await estabilizar(fixture);
      expect(document.activeElement?.id).toBe('motivo-reversion-30');

      boton(fixture, /^No revertir/).click();
      await estabilizar(fixture);
      expect(document.activeElement?.id).toBe('revertir-30');

      // Cerrar el panel devuelve el foco a lo que la fila dejo a la vista del que lo abrio.
      boton(fixture, /^Cerrar$/).click();
      await estabilizar(fixture);
      await new Promise((resolve) => setTimeout(resolve));
      expect(document.activeElement).toBe(menu);
    });

    it('sin derivaciones lo dice', async () => {
      const fixture = await conDerivaciones([]);
      expect(texto(fixture)).toContain('No tiene derivaciones en esta clase.');
      boton(fixture, /^Cerrar$/).click();
      await estabilizar(fixture);
      expect(fixture.nativeElement.querySelector('#titulo-derivaciones')).toBeNull();
    });
  });

  it('una clase no clínica lo dice y no ofrece nada', async () => {
    const fixture = await montar({ claseId: CLASE, clinica: false, participantes: [] });
    expect(texto(fixture)).toContain('Esta clase no genera registro clínico');
    expect(botones(fixture, /Iniciar/)).toHaveLength(0);
  });

  it('sin permiso, el error del panel con reintento', async () => {
    const fixture = TestBed.createComponent(AtencionGrupalPage);
    fixture.componentRef.setInput('claseId', String(CLASE));
    fixture.detectChanges();
    problema(http.expectOne(PANEL), 403, 'forbidden');
    // La clase va en paralelo y el error del panel la cancela.
    http.match(esLaClase);
    await estabilizar(fixture);
    expect(alerta(fixture)).toContain('No tenés permiso');
    boton(fixture, /Reintentar/).click();
    responderRecarga();
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Sintetica, Maria');
  });

  it('sin sede elegida no pide nada y lo dice', async () => {
    TestBed.inject(TenantContextStore).clear();
    const fixture = TestBed.createComponent(AtencionGrupalPage);
    fixture.componentRef.setInput('claseId', String(CLASE));
    fixture.detectChanges();
    await estabilizar(fixture);
    expect(alerta(fixture)).toContain('Eligi una organización');
  });

  it(
    'sin violaciones de accesibilidad con el panel y las derivaciones abiertas',
    async () => {
      const fixture = await montar();
      botones(fixture, /^Derivaciones/)[0].click();
      http.expectOne(derivacionesDe(MARIA)).flush({
        derivaciones: [
          { id: 30, casoClinicoId: 7, estado: 'VIGENTE', derivadaEn: '2026-10-20T13:10:00Z' },
        ],
      });
      await estabilizar(fixture);
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  // ------------------------------------------------------------------ apoyo

  async function montar(
    panel: object = PANEL_CLINICO,
  ): Promise<ComponentFixture<AtencionGrupalPage>> {
    const fixture = TestBed.createComponent(AtencionGrupalPage);
    fixture.componentRef.setInput('claseId', String(CLASE));
    fixture.detectChanges();
    http.expectOne(PANEL).flush(panel);
    http.expectOne(esLaClase).flush(CLASE_LEIDA);
    await estabilizar(fixture);
    return fixture;
  }

  function responderRecarga(): void {
    http.expectOne(PANEL).flush(PANEL_CLINICO);
    http.expectOne(esLaClase).flush(CLASE_LEIDA);
  }

  async function estabilizar(fixture: ComponentFixture<AtencionGrupalPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function problema(pedido: TestRequest, status: number, tipo: string, extra: object = {}): void {
    pedido.flush(
      {
        type: `https://akine.app/problems/${tipo}`,
        status,
        detail: 'texto del servidor',
        ...extra,
      },
      { status, statusText: 'Error' },
    );
  }

  function texto(fixture: ComponentFixture<AtencionGrupalPage>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  function alerta(fixture: ComponentFixture<AtencionGrupalPage>): string {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[role="alert"]'),
      (el) => el.textContent ?? '',
    ).join(' ');
  }

  function botones(
    fixture: ComponentFixture<AtencionGrupalPage>,
    nombre: RegExp,
  ): HTMLButtonElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).filter(
      (b) => nombre.test((b.textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
  }

  function boton(fixture: ComponentFixture<AtencionGrupalPage>, nombre: RegExp): HTMLButtonElement {
    const encontrado = botones(fixture, nombre)[0];
    if (encontrado === undefined) {
      throw new Error(`No hay botón ${nombre}`);
    }
    return encontrado;
  }

  function escribir(
    fixture: ComponentFixture<AtencionGrupalPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      selector,
    ) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
});
