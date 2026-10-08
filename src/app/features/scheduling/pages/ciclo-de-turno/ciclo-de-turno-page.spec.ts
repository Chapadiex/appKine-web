import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CicloDeTurnoPage } from './ciclo-de-turno-page';
import { PERMISO_TURNO_MANAGE, PERMISO_TURNO_READ } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const OFERTA = 42;
const TURNO = 301;
const FECHA = '2026-09-15';
const INICIO = '2026-09-15T12:00:00Z';
const SIGUIENTE = '2026-09-15T12:45:00Z';

const TURNO_URL = `/api/v1/consultorios/${CONSULTORIO}/turnos/${TURNO}`;
const TURNO_LEIDO = {
  id: TURNO,
  inicio: '2026-09-15T12:00:00Z',
  fin: '2026-09-15T12:45:00Z',
  estado: 'RESERVADO',
  personaId: 128,
  personaNombre: 'Perez, Ana',
  ofertaId: OFERTA,
  ofertaNombre: 'Kinesiologia',
  version: 0,
};
const HISTORIAL = `/api/v1/consultorios/${CONSULTORIO}/turnos/${TURNO}/historial`;
const CANCELACION = `/api/v1/consultorios/${CONSULTORIO}/turnos/${TURNO}/cancelacion`;
const AUSENCIA = `/api/v1/consultorios/${CONSULTORIO}/turnos/${TURNO}/ausencia`;
const CONFIRMACION = `/api/v1/consultorios/${CONSULTORIO}/turnos/${TURNO}/confirmacion`;
const REPROGRAMACION = `/api/v1/consultorios/${CONSULTORIO}/turnos/${TURNO}/reprogramacion`;
const AGENDA = `/api/v1/consultorios/${CONSULTORIO}/ofertas/${OFERTA}/agenda`;

const EVENTOS = [
  {
    id: 1,
    tipo: 'RESERVA',
    estadoNuevo: 'RESERVADO',
    inicioNuevo: INICIO,
    finNuevo: SIGUIENTE,
    ocurridoEn: '2026-09-01T14:03:11Z',
    actorCuentaId: 12,
  },
];

const DIA = {
  consultorioId: CONSULTORIO,
  ofertaId: OFERTA,
  nombreComercial: 'Kinesiologia deportiva',
  duracionMinutos: 45,
  timezone: 'America/Argentina/Cordoba',
  dias: [
    {
      fecha: FECHA,
      slots: [
        { desde: INICIO, hasta: SIGUIENTE, cupoLibre: 0, cupoTotal: 1, profesionalId: 31 },
        {
          desde: SIGUIENTE,
          hasta: '2026-09-15T13:30:00Z',
          cupoLibre: 1,
          cupoTotal: 1,
          profesionalId: 77,
        },
      ],
    },
  ],
};

/**
 * Spec del ciclo de vida del turno (M12, AKINE-05.03).
 *
 * <p>Cubre <b>cuatro cosas que deciden comportamiento</b> y ninguna del andamiaje:
 *
 * <ol>
 *   <li><b>La ausencia manda el pedido con el motivo vacio.</b> Es la trampa que ya se pago una
 *       vez: el componente compartido exige el motivo por default, y con ese default puesto el
 *       boton no emite nada —sin peticion, sin error y sin sintoma— y RF-M12 queda inejecutable
 *       desde la pantalla.</li>
 *   <li><b>La version se manda y se refresca.</b> Sin `expectedVersion` correcto la segunda
 *       operacion sobre el mismo turno muere en un 409 del que no se sale.</li>
 *   <li><b>Un turno con atencion se explica.</b> El requisito era explicito: no un "error
 *       inesperado".</li>
 *   <li><b>Sin version la pantalla no ofrece lo que va a fallar.</b> El contrato no publica
 *       ninguna lectura de un turno; ocultar los botones es lo unico honesto.</li>
 * </ol>
 */
describe('CicloDeTurnoPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CicloDeTurnoPage],
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

  afterEach(() => {
    httpMock.verify();
  });

  it('reconstruye estado y horario desde el historial, que es la unica lectura que hay', async () => {
    const fixture = await montar();
    const texto = textoDe(fixture);

    expect(texto).toContain('Reservado');
    // 12:00Z son las 09:00 en Cordoba: la zona sale de la agenda, no del navegador.
    expect(texto).toContain('09:00');
    expect(texto).toContain('America/Argentina/Cordoba');
    expect(texto).toContain('Se reservo el turno');
    expect(enlaceCon(fixture, 'Es parte de una serie')).toBeNull();
  });

  it('un turno de una serie enlaza a la serie', async () => {
    const fixture = await montar({ serieId: 7 });
    expect(enlaceCon(fixture, 'Es parte de una serie')?.getAttribute('href')).toBe(
      '/agenda/series/7',
    );
  });

  it('muestra el prepago pendiente del turno antes de la llegada (E-8), sin bloquear nada', async () => {
    const fixture = await montar({
      leido: {
        ...TURNO_LEIDO,
        prepago: { estado: 'PENDIENTE', importeSugerido: 15000, moneda: 'ARS' },
      },
    });

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Prepago pendiente si se atiende como particular');
    expect(texto).toMatch(/sugerido \$\s?15\.000,00/);
  });

  it('la ausencia sale con el motivo VACIO: el contrato lo declara opcional', async () => {
    const fixture = await montar();
    clickear(fixture, 'Marcar que no vino');

    // Sin tocar el campo. Con el default `motivoObligatorio` en true esto no emitiria nada y no
    // saldria ninguna peticion, que es exactamente el defecto que hay que impedir.
    enviarPanel(fixture);

    const pedido = httpMock.expectOne(AUSENCIA);
    expect(pedido.request.body).toEqual({ expectedVersion: 0 });
    pedido.flush({ id: TURNO, estado: 'AUSENTE', version: 1, inicio: INICIO, fin: SIGUIENTE });
    await asentar(fixture);

    httpMock.expectOne(HISTORIAL).flush(EVENTOS);
    await asentar(fixture);

    // Y el texto tiene que decir lo que la ausencia NO hace, que es lo que la separa de cancelar.
    expect(textoDe(fixture)).toContain('El lugar NO se libero');
  });

  it('cancelar manda motivo y version, y la version se refresca con la respuesta', async () => {
    const fixture = await montar();
    clickear(fixture, 'Cancelar el turno');
    escribirMotivo(fixture, 'El paciente aviso que no puede venir');
    enviarPanel(fixture);

    const pedido = httpMock.expectOne(CANCELACION);
    expect(pedido.request.body).toEqual({
      motivo: 'El paciente aviso que no puede venir',
      expectedVersion: 0,
    });
    // Version 4 en la respuesta: si la pantalla se quedara con la de la URL, la siguiente
    // operacion sobre este turno moriria en un 409 del que no se sale.
    pedido.flush({ id: TURNO, estado: 'CANCELADO', version: 4, inicio: INICIO, fin: SIGUIENTE });
    await asentar(fixture);

    httpMock.expectOne(HISTORIAL).flush(EVENTOS);
    await asentar(fixture);

    const texto = textoDe(fixture);
    expect(texto).toContain('El lugar se libero');
    // Ciclo cerrado: no se ofrece ninguna transicion mas sobre un turno cancelado.
    expect(texto).toContain('ya cerro su ciclo');
    expect(boton(fixture, 'Cancelar el turno')).toBeNull();
  });

  it('reprogramar manda el instante del slot elegido y SU profesional, que puede ser otro', async () => {
    const fixture = await montar();
    clickear(fixture, 'Mover a otro horario');
    // El primer slot esta completo; el segundo es de otro profesional. Mover un turno porque el
    // profesional se ausento es el caso normal, asi que el id sale del slot y no del turno.
    clickear(fixture, '09:45 a 10:30');
    escribirMotivo(fixture, 'El profesional pidio el dia');
    enviarPanel(fixture);

    const pedido = httpMock.expectOne(REPROGRAMACION);
    expect(pedido.request.body).toEqual({
      inicio: SIGUIENTE,
      motivo: 'El profesional pidio el dia',
      expectedVersion: 0,
      profesionalId: 77,
    });
    pedido.flush({ id: TURNO, estado: 'RESERVADO', version: 1, inicio: SIGUIENTE });
    await asentar(fixture);

    httpMock.expectOne(HISTORIAL).flush(EVENTOS);
    await asentar(fixture);

    // Es el MISMO turno: el mensaje lo dice, porque cancelar-y-crear seria otra cosa.
    expect(textoDe(fixture)).toContain('Es el mismo turno');
  });

  it('sin horario elegido no manda nada y lo dice, en vez de fallar en el servidor', async () => {
    const fixture = await montar();
    clickear(fixture, 'Mover a otro horario');
    escribirMotivo(fixture, 'El profesional pidio el dia');
    enviarPanel(fixture);

    httpMock.expectNone(REPROGRAMACION);
    expect(textoDe(fixture)).toContain('Elegi el horario destino');
  });

  it('el turno con atencion se explica y ofrece la atencion, no un "error inesperado"', async () => {
    const fixture = await montar();
    clickear(fixture, 'Cancelar el turno');
    escribirMotivo(fixture, 'Me equivoque de paciente');
    enviarPanel(fixture);

    httpMock.expectOne(CANCELACION).flush(
      {
        type: 'https://akine.app/problems/turno-con-atencion',
        status: 409,
        detail: 'Rechazado.',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);

    const texto = textoDe(fixture);
    expect(texto).toContain('atencion clinica registrada');
    expect(texto).not.toContain('No pudimos completar la operacion');
    // La unica salida real: reintentar devuelve el mismo 409 para siempre.
    const enlace = enlaceCon(fixture, 'Ver la atencion clinica');
    expect(enlace?.getAttribute('href')).toBe(`/atencion/turnos/${TURNO}`);
  });

  it('la transicion imposible manda a releer el turno y muestra el motivo del servidor', async () => {
    const fixture = await montar();
    clickear(fixture, 'Cancelar el turno');
    escribirMotivo(fixture, 'Tarde');
    enviarPanel(fixture);

    httpMock.expectOne(CANCELACION).flush(
      {
        type: 'https://akine.app/problems/turno-transicion-no-permitida',
        status: 409,
        detail: 'Rechazado.',
        motivo: 'ya empezo y no se puede mover',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);

    expect(textoDe(fixture)).toContain('ya empezo y no se puede mover');

    clickear(fixture, 'Releer el turno');
    responderLectura(false);
    httpMock.expectOne(HISTORIAL).flush(EVENTOS);
    httpMock.expectOne(esAgenda()).flush(DIA);
    await asentar(fixture);
  });

  /**
   * Encontrado por el E2E contra el backend real (AKINE E-2). Despues de una transicion hecha
   * desde esta pantalla, la respuesta de esa transicion le ganaba para siempre a cualquier
   * relectura: si otra persona movia el turno, "Releer el turno" traia la version nueva pero la
   * pantalla seguia mostrando el estado viejo y mandando la version vieja. El 409 no tenia salida.
   */
  it('releer despues de un 409 reemplaza lo que dejo la ultima transicion', async () => {
    const fixture = await montar();

    clickear(fixture, 'Confirmar el turno');
    httpMock
      .expectOne(CONFIRMACION)
      .flush({ id: TURNO, estado: 'CONFIRMADO', version: 1, inicio: INICIO, fin: SIGUIENTE });
    await asentar(fixture);
    httpMock.expectOne(HISTORIAL).flush(EVENTOS);
    await asentar(fixture);

    // Mientras tanto otra persona lo reprogramo (version 2): cancelar con la 1 rebota.
    clickear(fixture, 'Cancelar el turno');
    escribirMotivo(fixture, 'Con la version vieja');
    enviarPanel(fixture);
    httpMock
      .expectOne(CANCELACION)
      .flush(
        { type: 'https://akine.app/problems/conflict', status: 409, detail: 'Version vieja.' },
        { status: 409, statusText: 'Conflict' },
      );
    await asentar(fixture);

    clickear(fixture, 'Releer el turno');
    httpMock
      .expectOne((p: HttpRequest<unknown>) => p.method === 'GET' && p.url === TURNO_URL)
      .flush({ ...TURNO_LEIDO, estado: 'RESERVADO', version: 2 });
    httpMock.expectOne(HISTORIAL).flush(EVENTOS);
    httpMock.expectOne(esAgenda()).flush(DIA);
    await asentar(fixture);

    expect(textoDe(fixture)).toContain('Reservado');

    // El panel de cancelar sigue abierto: releer no tira lo que la persona ya escribio.
    escribirMotivo(fixture, 'Con la version vigente');
    enviarPanel(fixture);
    const vigente = httpMock.expectOne(CANCELACION);
    expect(vigente.request.body).toEqual({
      motivo: 'Con la version vigente',
      expectedVersion: 2,
    });
    vigente.flush({ id: TURNO, estado: 'CANCELADO', version: 3, inicio: INICIO, fin: SIGUIENTE });
    await asentar(fixture);
    httpMock.expectOne(HISTORIAL).flush(EVENTOS);
  });

  /** La otra cara del caso anterior, y tambien la vio el E2E: el orden de llegada no manda. */
  it('la lectura de la apertura que vuelve tarde no pisa una transicion mas nueva', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({ permissions: [PERMISO_TURNO_READ, PERMISO_TURNO_MANAGE] });
    const fixture = TestBed.createComponent(CicloDeTurnoPage);
    fixture.componentRef.setInput('turnoId', String(TURNO));
    fixture.componentRef.setInput('version', '0');
    fixture.componentRef.setInput('ofertaId', String(OFERTA));
    fixture.componentRef.setInput('fecha', FECHA);
    fixture.detectChanges();

    // La lectura de la apertura queda en vuelo mientras la persona confirma.
    const apertura = httpMock.expectOne(
      (p: HttpRequest<unknown>) => p.method === 'GET' && p.url === TURNO_URL,
    );
    httpMock.expectOne(HISTORIAL).flush(EVENTOS);
    httpMock.expectOne(esAgenda()).flush(DIA);
    await asentar(fixture);

    clickear(fixture, 'Confirmar el turno');
    httpMock
      .expectOne(CONFIRMACION)
      .flush({ id: TURNO, estado: 'CONFIRMADO', version: 1, inicio: INICIO, fin: SIGUIENTE });
    await asentar(fixture);
    httpMock.expectOne(HISTORIAL).flush(EVENTOS);

    apertura.flush(TURNO_LEIDO);
    await asentar(fixture);

    expect(textoDe(fixture)).toContain('Confirmado');
    expect(textoDe(fixture)).not.toContain('Reservado —');
  });

  /**
   * Es el motivo del cambio de 0.23.0. Antes, un enlace sin `?version=` dejaba la pantalla a
   * medias: historial completo, confirmar, y nada mas. Ahora la version sale de la lectura del
   * turno y la pantalla opera igual.
   */
  it('sin la version en la URL opera igual: la lee del turno', async () => {
    const fixture = await montar({ version: '' });

    expect(textoDe(fixture)).not.toContain('solo se puede confirmar');
    expect(boton(fixture, 'Cancelar el turno')).not.toBeNull();
    expect(boton(fixture, 'Mover a otro horario')).not.toBeNull();

    // Y la version que manda es la que trajo la lectura, no una inventada.
    clickear(fixture, 'Cancelar el turno');
    escribirMotivo(fixture, 'El paciente aviso');
    enviarPanel(fixture);
    const pedido = httpMock.expectOne(CANCELACION);
    expect((pedido.request.body as { expectedVersion: number }).expectedVersion).toBe(
      TURNO_LEIDO.version,
    );
    pedido.flush({ id: TURNO, estado: 'CANCELADO', version: 1, inicio: INICIO });
    await asentar(fixture);
    httpMock.expectOne(HISTORIAL).flush(EVENTOS);
    await asentar(fixture);
  });

  /**
   * El unico camino que hoy deja a la pantalla sin version: la lectura falla Y el enlace no la
   * trae. La degradacion sigue siendo la correcta —confirmar es idempotente y no lleva version—
   * y sigue estando explicada.
   */
  it('si la lectura del turno falla y no hay version en la URL, solo ofrece confirmar', async () => {
    const fixture = await montar({ version: '', lecturaFalla: true });

    const texto = textoDe(fixture);
    expect(texto).toContain('solo se puede confirmar');
    expect(boton(fixture, 'Cancelar el turno')).toBeNull();
    expect(boton(fixture, 'Marcar que no vino')).toBeNull();
    expect(boton(fixture, 'Mover a otro horario')).toBeNull();

    clickear(fixture, 'Confirmar el turno');
    httpMock
      .expectOne(CONFIRMACION)
      .flush({ id: TURNO, estado: 'CONFIRMADO', version: 1, inicio: INICIO });
    await asentar(fixture);
    httpMock.expectOne(HISTORIAL).flush(EVENTOS);
    await asentar(fixture);
  });

  it('sin `turno:manage` la pantalla es de lectura y no esconde que lo es', async () => {
    const fixture = await montar({ permisos: [PERMISO_TURNO_READ] });

    expect(textoDe(fixture)).toContain('Solo podes mirar este turno');
    expect(boton(fixture, 'Confirmar el turno')).toBeNull();
    // El historial sigue visible: leer quien cancelo y por que es `turno:read`, no `turno:manage`.
    expect(textoDe(fixture)).toContain('Se reservo el turno');
  });

  it(
    'no tiene violaciones de accesibilidad detectables',
    async () => {
      const fixture = await montar();
      // Ojo: `color-contrast` vuelve siempre `incomplete` bajo jsdom, que no calcula layout.
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  function textoDe(fixture: ComponentFixture<CicloDeTurnoPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function esAgenda(): (p: HttpRequest<unknown>) => boolean {
    return (p) => p.method === 'GET' && p.url === AGENDA;
  }

  function boton(
    fixture: ComponentFixture<CicloDeTurnoPage>,
    texto: string,
  ): HTMLButtonElement | null {
    return (
      (
        Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
        ) as HTMLButtonElement[]
      ).find((b) => (b.textContent ?? '').includes(texto)) ?? null
    );
  }

  function enlaceCon(
    fixture: ComponentFixture<CicloDeTurnoPage>,
    texto: string,
  ): HTMLAnchorElement | null {
    return (
      (
        Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll('a'),
        ) as HTMLAnchorElement[]
      ).find((a) => (a.textContent ?? '').includes(texto)) ?? null
    );
  }

  function clickear(fixture: ComponentFixture<CicloDeTurnoPage>, texto: string): void {
    const elegido = boton(fixture, texto);
    expect(elegido, `no se encontro el boton "${texto}"`).not.toBeNull();
    elegido?.click();
    fixture.detectChanges();
  }

  function escribirMotivo(fixture: ComponentFixture<CicloDeTurnoPage>, motivo: string): void {
    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      'input[type="text"]',
    ) as HTMLInputElement;
    campo.value = motivo;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function enviarPanel(fixture: ComponentFixture<CicloDeTurnoPage>): void {
    const formulario = (fixture.nativeElement as HTMLElement).querySelector(
      'form',
    ) as HTMLFormElement;
    formulario.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  async function asentar(fixture: ComponentFixture<CicloDeTurnoPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /**
   * Responde la lectura del turno que la pantalla hace al abrirse (contrato 0.23.0).
   *
   * <p>Con `falla`, la pantalla queda sin esa fuente y tiene que arreglarselas con la version
   * de la query — que es el camino que existia antes de que hubiera lectura, y que sigue
   * teniendo que funcionar.
   */
  function responderLectura(falla: boolean, leido: object = TURNO_LEIDO): void {
    const pedido = httpMock.expectOne(
      (p: HttpRequest<unknown>) => p.method === 'GET' && p.url === TURNO_URL,
    );
    if (falla) {
      pedido.flush(null, { status: 500, statusText: 'Server Error' });
    } else {
      pedido.flush(leido);
    }
  }

  async function montar(
    opciones: {
      version?: string;
      permisos?: string[];
      lecturaFalla?: boolean;
      leido?: object;
      serieId?: number;
    } = {},
  ): Promise<ComponentFixture<CicloDeTurnoPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({
      permissions: opciones.permisos ?? [PERMISO_TURNO_READ, PERMISO_TURNO_MANAGE],
    });

    const fixture = TestBed.createComponent(CicloDeTurnoPage);
    fixture.componentRef.setInput('turnoId', String(TURNO));
    fixture.componentRef.setInput('version', opciones.version ?? '0');
    fixture.componentRef.setInput('ofertaId', String(OFERTA));
    fixture.componentRef.setInput('fecha', FECHA);
    fixture.detectChanges();

    responderLectura(
      opciones.lecturaFalla === true,
      opciones.leido ??
        (opciones.serieId === undefined
          ? TURNO_LEIDO
          : { ...TURNO_LEIDO, serieId: opciones.serieId }),
    );
    httpMock.expectOne(HISTORIAL).flush(EVENTOS);
    httpMock.expectOne(esAgenda()).flush(DIA);
    await asentar(fixture);

    return fixture;
  }
});
