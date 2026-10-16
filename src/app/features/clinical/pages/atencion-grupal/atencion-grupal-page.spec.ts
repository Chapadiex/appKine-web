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
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';

const CONSULTORIO = 3;
const CLASE = 40;
const BASE = `/api/v1/consultorios/${CONSULTORIO}/clases/${CLASE}`;
const PANEL = `${BASE}/atencion-clinica`;
const LOTE = `${BASE}/atencion-clinica/lote`;
const DETALLE = `${BASE}/detalle-operativo`;
const MARIA = 71;
const JUAN = 72;
const ANA = 73;
const atencionDe = (inscripcion: number) => `${BASE}/inscripciones/${inscripcion}/atencion-clinica`;
const derivacionesDe = (inscripcion: number) => `${BASE}/inscripciones/${inscripcion}/derivaciones`;

/** Maria estuvo y no tiene atencion; Juan estuvo y tiene una cerrada; Ana falto. */
const PANEL_CLINICO = {
  claseId: CLASE,
  clinica: true,
  participantes: [
    {
      inscripcionId: MARIA,
      asistenciaId: 1,
      personaId: 501,
      estuvo: true,
      resultadoAsistencia: 'PRESENTE',
    },
    {
      inscripcionId: JUAN,
      asistenciaId: 2,
      personaId: 502,
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
      estuvo: false,
      resultadoAsistencia: 'AUSENTE',
    },
  ],
};

const DETALLE_CLASE = {
  claseId: CLASE,
  titulo: 'Rehabilitacion de rodilla',
  inicio: '2026-10-20T13:00:00Z',
  content: [
    { nombre: 'Maria', apellido: 'Sintetica', inscripcion: { id: MARIA } },
    { nombre: 'Juan', apellido: 'Sintetico', inscripcion: { id: JUAN } },
    { nombre: 'Ana', apellido: 'Sintetica', inscripcion: { id: ANA } },
  ],
};

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
  });

  afterEach(() => http.verify());

  it('lista quien estuvo, su asistencia y sus atenciones, con nombre y enlace a la atencion', async () => {
    const fixture = await montar();
    const tabla = texto(fixture);
    expect(tabla).toContain('Rehabilitacion de rodilla');
    expect(tabla).toContain('Sintetica, Maria');
    expect(tabla).toContain('Llego tarde');
    expect(tabla).toContain('Atencion cerrada · sesion 3 del caso · sesion 8 del paciente');
    const enlace = fixture.nativeElement.querySelector(
      'a[href="/atencion/sesiones/901"]',
    ) as HTMLAnchorElement | null;
    expect(enlace).not.toBeNull();
    // Solo Maria: Juan ya tiene atencion y Ana no estuvo.
    expect(botones(fixture, /^Iniciar atencion/)).toHaveLength(1);
    expect(boton(fixture, /Iniciar para todos/).textContent).toContain('(1)');
  });

  it('sin el detalle operativo se usa el numero de inscripcion en lugar del nombre', async () => {
    const fixture = TestBed.createComponent(AtencionGrupalPage);
    fixture.componentRef.setInput('claseId', String(CLASE));
    fixture.detectChanges();
    http.expectOne(PANEL).flush(PANEL_CLINICO);
    http
      .expectOne((r) => r.url === DETALLE)
      .flush({ type: 'x', status: 403 }, { status: 403, statusText: 'Forbidden' });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain(`Inscripcion ${MARIA}`);
  });

  it('iniciar la atencion de un participante la abre y lleva a ella', async () => {
    const fixture = await montar();
    boton(fixture, /^Iniciar atencion/).click();
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
    boton(fixture, /^Iniciar atencion/).click();
    problema(http.expectOne(atencionDe(MARIA)), 409, 'derivacion-ambigua', {
      derivacionIds: [30, 32],
    });
    http.expectOne(derivacionesDe(MARIA)).flush({
      derivaciones: [
        { id: 30, casoClinicoId: 7, estado: 'VIGENTE' },
        { id: 32, casoClinicoId: 8, estado: 'VIGENTE' },
      ],
    });
    responderRecarga();
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('mas de una derivacion vigente');
    expect(texto(fixture)).toContain('Caso clinico 7');
    expect(texto(fixture)).toContain('Caso clinico 8');
    expect(navegar).not.toHaveBeenCalled();

    botones(fixture, /Iniciar atencion desde esta derivacion/)[1].click();
    const pedido = http.expectOne(atencionDe(MARIA));
    expect(pedido.request.body).toEqual({ derivacionId: 32 });
    pedido.flush({ ...ABIERTA, sesionId: 902, derivacionId: 32 });
    await estabilizar(fixture);
    expect(navegar).toHaveBeenCalledWith('/atencion/sesiones/902');
  });

  it('sin derivacion lo dice con su texto propio, y no navega', async () => {
    const fixture = await montar();
    boton(fixture, /^Iniciar atencion/).click();
    problema(http.expectOne(atencionDe(MARIA)), 409, 'participacion-sin-derivacion');
    responderRecarga();
    await estabilizar(fixture);
    expect(alerta(fixture)).toContain('No tiene una derivacion clinica vigente');
    expect(navegar).not.toHaveBeenCalled();
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
    expect(resultado).toContain('Se abrieron 1 atencion.');
    expect(resultado).toContain('1 no se pudieron abrir');
    expect(resultado).toMatch(/Sintetica, Ana\s*: No tiene una derivacion clinica vigente/);
    expect(navegar).not.toHaveBeenCalled();
  });

  it('si el backend pide motivo de acceso lo pide en pantalla y reintenta con el', async () => {
    const fixture = await montar();
    boton(fixture, /^Iniciar atencion/).click();
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
    expect(texto(fixture)).toContain('Se abrieron 1 atencion.');
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

    it('pide motivo, y con 409 derivacion-con-sesion explica que la atencion la fija', async () => {
      const fixture = await conDerivaciones([{ id: 30, casoClinicoId: 7, estado: 'VIGENTE' }]);
      boton(fixture, /^Revertir la derivacion/).click();
      await estabilizar(fixture);
      boton(fixture, /Confirmar la reversion/).click();
      await estabilizar(fixture);
      expect(texto(fixture)).toContain('Escribi por que se revierte.');
      http.expectNone(`${derivacionesDe(MARIA)}/30/reversion`);

      escribir(fixture, '#motivo-reversion-30', 'Derivada por error');
      boton(fixture, /Confirmar la reversion/).click();
      const pedido = http.expectOne(`${derivacionesDe(MARIA)}/30/reversion`);
      expect(pedido.request.body).toEqual({ motivo: 'Derivada por error' });
      problema(pedido, 409, 'derivacion-con-sesion');
      await estabilizar(fixture);
      expect(alerta(fixture)).toContain('ya se abrio una atencion clinica desde ella');
    });

    it('revertida, relee las derivaciones y el panel, y lo confirma', async () => {
      const fixture = await conDerivaciones([{ id: 30, casoClinicoId: 7, estado: 'VIGENTE' }]);
      boton(fixture, /^Revertir la derivacion/).click();
      await estabilizar(fixture);
      escribir(fixture, '#motivo-reversion-30', 'Derivada por error');
      boton(fixture, /Confirmar la reversion/).click();
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
      expect(texto(fixture)).toContain('Motivo de la reversion: Derivada por error');
      expect(botones(fixture, /^Revertir la derivacion/)).toHaveLength(0);
    });

    it('con la atencion abierta desde la derivacion no ofrece revertir y dice por que', async () => {
      const fixture = await conDerivaciones(
        [{ id: 31, casoClinicoId: 7, estado: 'VIGENTE' }],
        JUAN,
      );
      expect(texto(fixture)).toContain('la derivacion no se puede revertir');
      expect(botones(fixture, /^Revertir la derivacion/)).toHaveLength(0);
    });

    it('sin derivaciones lo dice', async () => {
      const fixture = await conDerivaciones([]);
      expect(texto(fixture)).toContain('No tiene derivaciones en esta clase.');
      boton(fixture, /^Cerrar$/).click();
      await estabilizar(fixture);
      expect(fixture.nativeElement.querySelector('#titulo-derivaciones')).toBeNull();
    });
  });

  it('una clase no clinica lo dice y no ofrece nada', async () => {
    const fixture = await montar({ claseId: CLASE, clinica: false, participantes: [] });
    expect(texto(fixture)).toContain('Esta clase no genera registro clinico');
    expect(botones(fixture, /Iniciar/)).toHaveLength(0);
  });

  it('sin permiso, el error del panel con reintento', async () => {
    const fixture = TestBed.createComponent(AtencionGrupalPage);
    fixture.componentRef.setInput('claseId', String(CLASE));
    fixture.detectChanges();
    problema(http.expectOne(PANEL), 403, 'forbidden');
    // El detalle va en paralelo y el error del panel lo cancela.
    http.match((r) => r.url === DETALLE);
    await estabilizar(fixture);
    expect(alerta(fixture)).toContain('No tenes permiso');
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
    expect(alerta(fixture)).toContain('Eligi una organizacion');
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
    http.expectOne((r) => r.url === DETALLE).flush(DETALLE_CLASE);
    await estabilizar(fixture);
    return fixture;
  }

  function responderRecarga(): void {
    http.expectOne(PANEL).flush(PANEL_CLINICO);
    http.expectOne((r) => r.url === DETALLE).flush(DETALLE_CLASE);
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
      throw new Error(`No hay boton ${nombre}`);
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
