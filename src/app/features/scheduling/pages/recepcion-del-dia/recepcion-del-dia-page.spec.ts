import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { RecepcionDelDiaPage } from './recepcion-del-dia-page';
import { PERMISO_TURNO_MANAGE, PERMISO_TURNO_READ } from '../../../../core/models/permisos';
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
const llegada = (turnoId: number) => `${TURNOS}/${turnoId}/llegada`;

/**
 * Tres filas sinteticas que cubren los tres comportamientos distintos de la pantalla: una por
 * llegar, una que ya llego y una cancelada. Sin ningun dato clinico, porque la respuesta tampoco
 * lo trae.
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
    estado: 'EN_ESPERA',
    inicio: '2026-09-15T13:00:00Z',
    fin: '2026-09-15T13:45:00Z',
    llegadaEn: '2026-09-15T12:51:00Z',
    personaNombre: 'Sosa, Bruno',
    documento: 'DNI 30111222',
    ofertaId: OFERTA,
    ofertaNombre: 'Kinesiologia deportiva',
    version: 5,
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
];

const ZONA = 'America/Argentina/Cordoba';

/**
 * Spec de la recepcion del dia (M13, AKINE-05.04).
 *
 * <p>Cubre <b>cinco cosas que deciden comportamiento</b> y ninguna del andamiaje:
 *
 * <ol>
 *   <li><b>Los cancelados se muestran, con su motivo y sin acciones de llegada.</b> Es el caso que
 *       la etapa pidio explicitamente que no se filtrara, y el que un "arreglo" bienintencionado
 *       rompe primero.</li>
 *   <li><b>Las horas salen en la zona de la SEDE.</b> Con la del navegador la pantalla no falla:
 *       miente, que es peor.</li>
 *   <li><b>Marcar la llegada dos veces no es un error.</b> El check-in es idempotente y el doble
 *       click del mostrador es el caso normal.</li>
 *   <li><b>Deshacer lo ya deshecho se explica.</b> No es idempotente, responde 409, y ese 409 no
 *       puede aparecer como "error inesperado".</li>
 *   <li><b>`EN_ESPERA` no dice que lo esten atendiendo.</b> Si el texto sugiere lo contrario, la
 *       pantalla fusiono Recepcion con Sesion, que es lo que DP-05 separa.</li>
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
    // La hora de llegada es la del servidor, tambien en la zona de la sede: 12:51Z -> 09:51.
    expect(texto).toContain('09:51');
    expect(texto).toContain('Todavia no llego');
  });

  it('muestra los cancelados con su motivo y SIN acciones de llegada', async () => {
    const fixture = await montar();

    // No se filtran: alguien se presenta al mostrador con un turno cancelado y hay que poder
    // decirle por que.
    expect(textoDe(fixture)).toContain('Vega, Carla');
    expect(textoDe(fixture)).toContain('El profesional pidio el dia');

    // Y ninguna fila cancelada ofrece marcar la llegada: el backend tambien la rechazaria.
    expect(botonesDeLaFila(fixture, 'Vega, Carla')).toEqual([]);
  });

  it('marcar la llegada manda un POST sin cuerpo y deja al paciente EN ESPERA, no atendido', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Ramirez, Ana', 'Marcar la llegada');

    const pedido = httpMock.expectOne(llegada(301));
    expect(pedido.request.method).toBe('POST');
    // Sin cuerpo: la hora la pone el servidor, que es lo que la hace la hora REAL de llegada.
    expect(pedido.request.body).toBeNull();
    pedido.flush({ id: 301, estado: 'EN_ESPERA', llegadaEn: '2026-09-15T11:40:00Z', version: 3 });
    await asentar(fixture);

    const texto = textoDe(fixture);
    expect(texto).toContain('Queda en espera: llego y aguarda');
    // La prestacion la registra la Sesion (DP-05). El estado dice que AGUARDA ser atendido, que
    // es lo contrario de estar siendo atendido: si alguna vez dice lo segundo, la pantalla fusiono
    // Recepcion con Sesion.
    expect(texto).toContain('aguarda ser atendido');
    expect(texto).not.toContain('atendiendo');
    expect(texto).not.toContain('En atencion');
    // La fila se acomodo con lo que devolvio el servidor: 11:40Z -> 08:40 en Cordoba.
    expect(texto).toContain('08:40');
    // Y ahora ofrece lo contrario.
    expect(botonesDeLaFila(fixture, 'Ramirez, Ana')).toContain('Deshacer la llegada');
  });

  it('marcar dos veces NO es un error: el check-in es idempotente', async () => {
    const fixture = await montar();

    // Dos clicks seguidos, sin dejar que la pantalla se redibuje entre medio: es literalmente el
    // doble click del mostrador, y es el caso normal, no un error del que haya que defenderse.
    const boton = botonDeLaFila(fixture, 'Ramirez, Ana', 'Marcar la llegada');
    boton?.click();
    boton?.click();

    const pedidos = httpMock.match(llegada(301));
    const respuesta = {
      id: 301,
      estado: 'EN_ESPERA',
      llegadaEn: '2026-09-15T11:40:00Z',
      version: 3,
    };
    // El servidor contesta 200 a los dos, con la MISMA hora: no la mueve ni registra un segundo
    // evento.
    pedidos.forEach((p) => p.flush(respuesta));
    await asentar(fixture);

    const texto = textoDe(fixture);
    expect(texto).toContain('Llegada registrada');
    expect(texto).not.toContain('No se pudo completar la operacion');
  });

  it('deshacer lo ya deshecho se explica, y la fila se corrige sola', async () => {
    const fixture = await montar();

    clickearEnLaFila(fixture, 'Sosa, Bruno', 'Deshacer la llegada');

    // Deshacer NO es idempotente, al reves que marcar. El backend responde 409 con su motivo.
    httpMock.expectOne(llegada(302)).flush(
      {
        type: 'https://akine.app/problems/turno-transicion-no-permitida',
        status: 409,
        detail: 'Rechazado.',
        motivo: 'no esta en espera: no hay ninguna llegada que deshacer',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);

    const texto = textoDe(fixture);
    expect(texto).toContain('idempotente');
    expect(texto).toContain('no hay ninguna llegada que deshacer');
    expect(texto).not.toContain('No pudimos completar la operacion');

    // Y relee ESA fila sola, no el dia entero: recargar todo le mueve la lista bajo el dedo a
    // quien esta atendiendo a alguien.
    httpMock.expectNone(esDelDia());
    httpMock.expectOne(`${TURNOS}/302`).flush({
      ...DEL_DIA[1],
      estado: 'CONFIRMADO',
      llegadaEn: undefined,
      version: 6,
    });
    await asentar(fixture);

    // La fila quedo con lo que dice el servidor: ya no ofrece deshacer, ofrece marcar.
    expect(botonesDeLaFila(fixture, 'Sosa, Bruno')).toEqual(['Marcar la llegada']);
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
