import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { RecepcionDelDiaPage } from './recepcion-del-dia-page';
import {
  PERMISO_COBRO_REGISTER,
  PERMISO_TURNO_MANAGE,
  PERMISO_TURNO_READ,
} from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const OFERTA = 42;
const FECHA = '2026-09-15';

const TURNOS = `/api/v1/consultorios/${CONSULTORIO}/turnos`;
const AGENDA = `/api/v1/consultorios/${CONSULTORIO}/ofertas/${OFERTA}/agenda`;
const recepcion = (turnoId: number, paso = '') =>
  `${TURNOS}/${turnoId}/recepcion${paso === '' ? '' : `/${paso}`}`;

/**
 * Cuatro filas sinteticas: una por llegar, una en la sala de espera, una cancelada y una que llego
 * y todavia no se valido. Sin ningun dato clinico, porque la respuesta tampoco lo trae.
 *
 * <p>Ninguna lleva `EN_ESPERA` en el estado del TURNO: desde 0.63.0 el servidor no lo emite y la
 * espera es de la recepcion (DP-16).
 */
const DEL_DIA = [
  {
    id: 301,
    estado: 'CONFIRMADO',
    inicio: '2026-09-15T12:00:00Z',
    fin: '2026-09-15T12:45:00Z',
    personaNombre: 'Ramirez, Ana',
    documento: 'DNI 27888999',
    ofertaId: OFERTA,
    ofertaNombre: 'Kinesiologia deportiva',
    version: 2,
  },
  {
    id: 302,
    estado: 'RESERVADO',
    inicio: '2026-09-15T13:00:00Z',
    fin: '2026-09-15T13:45:00Z',
    llegadaEn: '2026-09-15T12:51:00Z',
    recepcion: {
      id: 902,
      turnoId: 302,
      estado: 'EN_ESPERA',
      llegadaEn: '2026-09-15T12:51:00Z',
      modalidad: 'COBERTURA',
      version: 4,
    },
    personaNombre: 'Sosa, Bruno',
    documento: 'DNI 30111222',
    ofertaId: OFERTA,
    ofertaNombre: 'Kinesiologia deportiva',
    version: 6,
  },
  {
    id: 303,
    estado: 'CANCELADO',
    inicio: '2026-09-15T14:00:00Z',
    fin: '2026-09-15T14:45:00Z',
    motivoCancelacion: 'El profesional pidio el dia',
    personaNombre: 'Vega, Carla',
    documento: 'DNI 33444555',
    ofertaId: OFERTA,
    ofertaNombre: 'Kinesiologia deportiva',
    version: 3,
  },
  {
    id: 304,
    estado: 'RESERVADO',
    inicio: '2026-09-15T15:00:00Z',
    fin: '2026-09-15T15:45:00Z',
    llegadaEn: '2026-09-15T14:55:00Z',
    recepcion: {
      id: 904,
      turnoId: 304,
      estado: 'LLEGO',
      llegadaEn: '2026-09-15T14:55:00Z',
      version: 1,
    },
    personaNombre: 'Ibarra, Dario',
    documento: 'DNI 35666777',
    ofertaId: OFERTA,
    ofertaNombre: 'Kinesiologia deportiva',
    version: 4,
  },
];

const ZONA = 'America/Argentina/Cordoba';

/**
 * Spec de la recepcion del dia (M13, AKINE-05.04 y E-4).
 *
 * <p>Cubre lo que decide comportamiento:
 *
 * <ol>
 *   <li><b>Los cancelados se muestran, con su motivo y sin acciones.</b></li>
 *   <li><b>Las horas salen en la zona de la SEDE.</b></li>
 *   <li><b>El check-in va a la Recepcion, no al turno</b>, y registrar dos veces no es error.</li>
 *   <li><b>Una validacion observada no es un error</b> y deja seguir (RN-M13-003).</li>
 *   <li><b>Particular exige motivo</b> (RF-M13-005).</li>
 *   <li><b>Anular lo ya anulado se explica</b> y la fila se corrige sola.</li>
 *   <li><b>Llamar no dice que lo esten atendiendo</b>: eso es la Sesion (DP-05).</li>
 * </ol>
 */
describe('RecepcionDelDiaPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecepcionDelDiaPage],
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
    // Tambien prueba que nada pega contra los `/llegada` deprecados: seria un pedido sin atender.
    httpMock.verify();
  });

  it('lista el dia con el paciente resuelto y las horas en la zona de la SEDE', async () => {
    const fixture = await montar();
    const texto = textoDe(fixture);

    expect(texto).toContain('Ramirez, Ana');
    expect(texto).toContain('DNI 27888999');
    expect(texto).toContain('Kinesiologia deportiva');
    // 12:00Z son las 09:00 en Cordoba. Con la zona del navegador este numero cambia y nada falla.
    expect(texto).toContain('09:00 a 09:45');
    expect(texto).toContain('America/Argentina/Cordoba');
    // La hora de llegada es la de la recepcion, tambien en la zona de la sede: 12:51Z -> 09:51.
    expect(texto).toContain('09:51');
    expect(texto).toContain('Todavia no llego');
    // La espera se cuenta por la recepcion, no por el estado del turno.
    expect(texto).toContain('1 en espera');
    expect(texto).toContain('aguarda ser llamado');
  });

  it('muestra los cancelados con su motivo y SIN acciones', async () => {
    const fixture = await montar();

    expect(textoDe(fixture)).toContain('Vega, Carla');
    expect(textoDe(fixture)).toContain('El profesional pidio el dia');
    expect(botonesDeLaFila(fixture, 'Vega, Carla')).toEqual([]);
  });

  it('registrar la llegada abre la RECEPCION con un POST sin cuerpo y relee el turno', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Ramirez, Ana', 'Registrar la llegada');

    const pedido = httpMock.expectOne(recepcion(301));
    expect(pedido.request.method).toBe('POST');
    // Sin cuerpo: la hora la pone el servidor, que es lo que la hace la hora REAL de llegada.
    expect(pedido.request.body).toBeNull();
    pedido.flush({
      id: 901,
      turnoId: 301,
      estado: 'LLEGO',
      llegadaEn: '2026-09-15T11:40:00Z',
      version: 0,
    });
    await asentar(fixture);

    // El check-in avanza la version del TURNO aunque no cambie su estado: la fila se relee para
    // que el enlace al ciclo del turno no lleve una version vieja.
    httpMock.expectOne(`${TURNOS}/301`).flush({
      ...DEL_DIA[0],
      llegadaEn: '2026-09-15T11:40:00Z',
      recepcion: { id: 901, estado: 'LLEGO', llegadaEn: '2026-09-15T11:40:00Z', version: 0 },
      version: 3,
    });
    await asentar(fixture);

    const texto = textoDe(fixture);
    expect(texto).toContain('Llegada registrada');
    expect(texto).not.toContain('atendiendo');
    // 11:40Z -> 08:40 en Cordoba.
    expect(texto).toContain('08:40');
    expect(botonesDeLaFila(fixture, 'Ramirez, Ana')).toEqual([
      'Validar cobertura',
      'Atender como Particular',
      'Anular la llegada',
    ]);
  });

  it('registrar dos veces NO es un error: el check-in es idempotente', async () => {
    const fixture = await montar();

    const boton = botonDeLaFila(fixture, 'Ramirez, Ana', 'Registrar la llegada');
    boton?.click();
    boton?.click();

    const respuesta = { id: 901, estado: 'LLEGO', llegadaEn: '2026-09-15T11:40:00Z', version: 0 };
    httpMock.match(recepcion(301)).forEach((p) => p.flush(respuesta));
    await asentar(fixture);
    httpMock
      .match(`${TURNOS}/301`)
      .forEach((p) => p.flush({ ...DEL_DIA[0], recepcion: respuesta }));
    await asentar(fixture);

    const texto = textoDe(fixture);
    expect(texto).toContain('Llegada registrada');
    expect(texto).not.toContain('No se pudo completar la operacion');
  });

  it('una validacion OBSERVADA no es un error: muestra la observacion y deja seguir', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Ibarra, Dario', 'Validar cobertura');

    const pedido = httpMock.expectOne(recepcion(304, 'validacion'));
    expect(pedido.request.method).toBe('POST');
    // La version es la de la RECEPCION (1), no la del turno (4).
    expect(pedido.request.body).toEqual({ expectedVersion: 1 });
    pedido.flush({
      ...DEL_DIA[3].recepcion,
      estado: 'OBSERVADA',
      observacion: 'SIN_COBERTURA_APLICABLE: no tiene cobertura para esta practica',
      version: 2,
    });
    await asentar(fixture);

    const texto = textoDe(fixture);
    expect(texto).toContain('quedo observada');
    expect(texto).toContain('SIN_COBERTURA_APLICABLE');
    expect(texto).not.toContain('No se pudo completar la operacion');
    expect(botonesDeLaFila(fixture, 'Ibarra, Dario')).toEqual([
      'Validar cobertura',
      'Atender como Particular',
      'Pasar a espera',
      'Anular la llegada',
    ]);
  });

  it('Particular exige motivo: vacio no manda nada, con motivo manda la version de la recepcion', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Ibarra, Dario', 'Atender como Particular');
    const raiz = fixture.nativeElement as HTMLElement;
    const confirmar = (): void => {
      (raiz.querySelector('section form button[type="submit"]') as HTMLButtonElement).click();
      fixture.detectChanges();
    };

    confirmar();
    expect(textoDe(fixture)).toContain('es obligatorio');
    httpMock.expectNone(recepcion(304, 'particular'));

    const campo = raiz.querySelector('#recepcion-motivo-particular') as HTMLInputElement;
    campo.value = 'No trajo la orden y prefiere abonar';
    campo.dispatchEvent(new Event('input'));
    confirmar();

    const pedido = httpMock.expectOne(recepcion(304, 'particular'));
    expect(pedido.request.body).toEqual({
      expectedVersion: 1,
      motivo: 'No trajo la orden y prefiere abonar',
    });
    pedido.flush({
      ...DEL_DIA[3].recepcion,
      estado: 'VALIDADA',
      modalidad: 'PARTICULAR',
      version: 2,
    });
    await asentar(fixture);

    expect(textoDe(fixture)).toContain('se atiende como Particular');
    expect(botonesDeLaFila(fixture, 'Ibarra, Dario')).toEqual([
      'Pasar a espera',
      'Anular la llegada',
    ]);
  });

  it('llamar a quien espera no dice que lo esten atendiendo', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Sosa, Bruno', 'Llamar');

    const pedido = httpMock.expectOne(recepcion(302, 'llamado'));
    expect(pedido.request.body).toEqual({ expectedVersion: 4 });
    pedido.flush({ ...DEL_DIA[1].recepcion, estado: 'LLAMADA', version: 5 });
    await asentar(fixture);

    const texto = textoDe(fixture);
    expect(texto).toContain('Llamar no registra la atencion');
    expect(texto).toContain('la atencion es otro registro');
    expect(texto).toContain('0 en espera');
    expect(botonesDeLaFila(fixture, 'Sosa, Bruno')).toEqual(['Anular la llegada']);
  });

  it('pasar a espera manda la version de la recepcion', async () => {
    const fixture = await montar({
      turnos: [{ ...DEL_DIA[3], recepcion: { ...DEL_DIA[3].recepcion, estado: 'VALIDADA' } }],
    });

    clickearEnLaFila(fixture, 'Ibarra, Dario', 'Pasar a espera');

    const pedido = httpMock.expectOne(recepcion(304, 'espera'));
    expect(pedido.request.body).toEqual({ expectedVersion: 1 });
    pedido.flush({ ...DEL_DIA[3].recepcion, estado: 'EN_ESPERA', version: 2 });
    await asentar(fixture);

    expect(textoDe(fixture)).toContain('paso a la sala de espera');
    expect(botonesDeLaFila(fixture, 'Ibarra, Dario')).toEqual(['Llamar', 'Anular la llegada']);
  });

  it('anular deja la fila sin recepcion y vuelve a ofrecer el check-in', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Ibarra, Dario', 'Anular la llegada');
    // El motivo es opcional: se confirma vacio.
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        'section form button[type="submit"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    const pedido = httpMock.expectOne(recepcion(304, 'anulacion'));
    expect(pedido.request.body).toEqual({ expectedVersion: 1 });
    pedido.flush({ ...DEL_DIA[3].recepcion, estado: 'ANULADA', version: 2 });
    await asentar(fixture);

    expect(textoDe(fixture)).toContain('anulada');
    expect(botonesDeLaFila(fixture, 'Ibarra, Dario')).toEqual(['Registrar la llegada']);
  });

  it('anular lo ya anulado se explica, y la fila se corrige sola', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Sosa, Bruno', 'Anular la llegada');
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        'section form button[type="submit"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    httpMock.expectOne(recepcion(302, 'anulacion')).flush(
      {
        type: 'https://akine.app/problems/recepcion-transicion-no-permitida',
        status: 409,
        detail: 'Rechazado.',
        motivo: 'no hay recepcion abierta: no hay ninguna llegada que anular',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);

    const texto = textoDe(fixture);
    expect(texto).toContain('idempotente');
    expect(texto).toContain('no hay ninguna llegada que anular');
    expect(texto).not.toContain('No pudimos completar la operacion');

    // Relee ESA fila sola, no el dia entero.
    httpMock.expectNone(esDelDia());
    httpMock.expectOne(`${TURNOS}/302`).flush({
      ...DEL_DIA[1],
      llegadaEn: undefined,
      recepcion: undefined,
      version: 7,
    });
    await asentar(fixture);

    expect(botonesDeLaFila(fixture, 'Sosa, Bruno')).toEqual(['Registrar la llegada']);
  });

  it('sin `turno:manage` la pantalla es de lectura y no esconde que lo es', async () => {
    const fixture = await montar({ permisos: [PERMISO_TURNO_READ] });

    expect(textoDe(fixture)).toContain('Solo podes mirar la lista');
    expect(botonesDeLaFila(fixture, 'Ramirez, Ana')).toEqual([]);
    expect(botonesDeLaFila(fixture, 'Sosa, Bruno')).toEqual([]);
    // La lista se sigue viendo: leer quien viene hoy es `turno:read`.
    expect(textoDe(fixture)).toContain('Ramirez, Ana');
  });

  it('un dia sin turnos no pide la zona ni deja la pantalla en blanco', async () => {
    const fixture = await montar({ turnos: [] });

    expect(textoDe(fixture)).toContain('no tiene ningun turno agendado');
    // Sin turnos no hay oferta de donde sacar la zona, y no se inventa una peticion.
    httpMock.expectNone(esAgenda());
  });

  /**
   * Encontrado por el E2E contra el backend real (AKINE E-2). El unico enlace a esta pantalla
   * —"Ver la recepcion del dia", desde la agenda— no lleva `?fecha=`, y `withComponentInputBinding`
   * no deja el input en su default cuando falta el parametro: lo pone en `undefined`. La pantalla
   * llamaba al cliente generado con `fecha` indefinida, que lanza antes de salir a la red, y
   * quedaba en blanco: sin lista, sin error y con el campo de fecha vacio.
   */
  it('sin `?fecha=` en la URL abre el dia de hoy, que es lo que pasa al entrar desde la agenda', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_TURNO_READ] });

    const fixture = TestBed.createComponent(RecepcionDelDiaPage);
    // Lo que hace el router con un query param ausente.
    fixture.componentRef.setInput('fecha', undefined);
    fixture.detectChanges();

    const pedido = httpMock.expectOne(esDelDia());
    expect(pedido.request.params.get('fecha')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    pedido.flush({ fecha: pedido.request.params.get('fecha'), timezone: ZONA, turnos: [] });
    await asentar(fixture);

    expect(textoDe(fixture)).toContain('no tiene ningun turno agendado');
  });

  it('cambiar la fecha vuelve a pedir ESE dia', async () => {
    const fixture = await montar();

    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      'input[type="date"]',
    ) as HTMLInputElement;
    campo.value = '2026-09-16';
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const pedido = httpMock.expectOne(esDelDia());
    expect(pedido.request.params.get('fecha')).toBe('2026-09-16');
    pedido.flush([]);
    await asentar(fixture);

    expect(textoDe(fixture)).toContain('no tiene ningun turno agendado');
  });

  it('si no se puede saber la zona de la sede lo dice, en vez de usar la del navegador', async () => {
    const fixture = await montar({ zona: 'falla' });

    // El contrato no publica el `timezone` en la respuesta del dia. Rotular UTC es lo unico
    // honesto: la zona del navegador correria las horas del mostrador sin que nada falle.
    expect(textoDe(fixture)).toContain('no se pudo averiguar la zona horaria');
  });

  describe('prepago (E-6)', () => {
    const PENDIENTE = {
      ...DEL_DIA[3],
      personaId: 501,
      recepcion: {
        ...DEL_DIA[3].recepcion,
        estado: 'VALIDADA',
        prepago: { estado: 'PENDIENTE', importeSugerido: 15000, moneda: 'ARS' },
      },
    };

    it('PENDIENTE avisa con el sugerido, no bloquea y lleva al cobro con el turno', async () => {
      const fixture = await montar({
        permisos: [PERMISO_TURNO_READ, PERMISO_TURNO_MANAGE, PERMISO_COBRO_REGISTER],
        turnos: [PENDIENTE],
      });

      const texto = fila(fixture, 'Ibarra, Dario').textContent ?? '';
      expect(texto).toContain('Prepago pendiente');
      expect(texto).toMatch(/sugerido \$\s?15\.000,00/);
      // Avisa y no bloquea: pasar a espera sigue disponible.
      expect(botonesDeLaFila(fixture, 'Ibarra, Dario')).toContain('Pasar a espera');

      const enlace = Array.from(fila(fixture, 'Ibarra, Dario').querySelectorAll('a')).find((a) =>
        (a.textContent ?? '').includes('Registrar prepago'),
      ) as HTMLAnchorElement;
      expect(enlace.getAttribute('href')).toBe(
        `/pacientes/501/cuenta-corriente/cobrar?turnoId=304&fecha=${FECHA}` +
          '&importeSugerido=15000&monedaSugerida=ARS',
      );
    });

    it('pasar a espera con el prepago pendiente se permite y lo dice', async () => {
      const fixture = await montar({ turnos: [PENDIENTE] });

      // Sin `cobro:register` no se ofrece cobrar, pero el aviso sigue a la vista.
      expect(textoDe(fixture)).not.toContain('Registrar prepago');
      clickearEnLaFila(fixture, 'Ibarra, Dario', 'Pasar a espera');
      httpMock
        .expectOne(recepcion(304, 'espera'))
        .flush({ ...PENDIENTE.recepcion, estado: 'EN_ESPERA', version: 2 });
      await asentar(fixture);

      expect(textoDe(fixture)).toContain('Paso sin el prepago que exige la prestacion');
    });

    it('REGISTRADO muestra el anticipo y no ofrece cobrar de nuevo', async () => {
      const fixture = await montar({
        permisos: [PERMISO_TURNO_READ, PERMISO_TURNO_MANAGE, PERMISO_COBRO_REGISTER],
        turnos: [
          {
            ...PENDIENTE,
            recepcion: {
              ...PENDIENTE.recepcion,
              prepago: { estado: 'REGISTRADO', cobroId: 9, importe: 15000, moneda: 'ARS' },
            },
          },
        ],
      });

      expect(textoDe(fixture)).toContain('Prepago registrado por');
      expect(textoDe(fixture)).not.toContain('Registrar prepago');
    });
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

  function textoDe(fixture: ComponentFixture<RecepcionDelDiaPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function esDelDia(): (p: HttpRequest<unknown>) => boolean {
    return (p) => p.method === 'GET' && p.url === TURNOS;
  }

  function esAgenda(): (p: HttpRequest<unknown>) => boolean {
    return (p) => p.method === 'GET' && p.url === AGENDA;
  }

  /** La fila de la tabla que contiene ese nombre. */
  function fila(fixture: ComponentFixture<RecepcionDelDiaPage>, nombre: string): HTMLElement {
    const encontrada = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr'),
    ).find((f) => (f.textContent ?? '').includes(nombre));
    expect(encontrada, `no se encontro la fila de "${nombre}"`).toBeDefined();
    return encontrada as HTMLElement;
  }

  function botonesDeLaFila(
    fixture: ComponentFixture<RecepcionDelDiaPage>,
    nombre: string,
  ): string[] {
    return Array.from(fila(fixture, nombre).querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim(),
    );
  }

  function botonDeLaFila(
    fixture: ComponentFixture<RecepcionDelDiaPage>,
    nombre: string,
    texto: string,
  ): HTMLButtonElement | null {
    return (
      (Array.from(fila(fixture, nombre).querySelectorAll('button')) as HTMLButtonElement[]).find(
        (b) => (b.textContent ?? '').includes(texto),
      ) ?? null
    );
  }

  function clickearEnLaFila(
    fixture: ComponentFixture<RecepcionDelDiaPage>,
    nombre: string,
    texto: string,
  ): void {
    const boton = botonDeLaFila(fixture, nombre, texto);
    expect(boton, `no se encontro el boton "${texto}" en la fila de "${nombre}"`).not.toBeNull();
    boton?.click();
    fixture.detectChanges();
  }

  async function asentar(fixture: ComponentFixture<RecepcionDelDiaPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function montar(
    opciones: {
      permisos?: string[];
      turnos?: unknown[];
      zona?: 'ok' | 'falla';
    } = {},
  ): Promise<ComponentFixture<RecepcionDelDiaPage>> {
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

    const fixture = TestBed.createComponent(RecepcionDelDiaPage);
    fixture.componentRef.setInput('fecha', FECHA);
    fixture.detectChanges();

    const turnos = opciones.turnos ?? DEL_DIA;
    const delDia = httpMock.expectOne(esDelDia());
    expect(delDia.request.params.get('fecha')).toBe(FECHA);
    // Desde 0.24.0 la respuesta es un objeto y la zona viaja en el cuerpo: ya no hay una
    // segunda lectura de agenda de la que deducirla. `zona: 'falla'` simula que el backend la
    // manda vacia, que es lo unico que hoy puede dejar a la pantalla sin ella.
    delDia.flush({
      fecha: FECHA,
      timezone: opciones.zona === 'falla' ? '' : ZONA,
      turnos,
    });
    await asentar(fixture);

    return fixture;
  }
});
