import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PERMISO_TURNO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { ReservaDeTurnoPage } from './reserva-de-turno-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const OFERTA = 42;
const FECHA = '2026-09-15';
const INICIO = '2026-09-15T12:00:00Z';
const SIGUIENTE = '2026-09-15T12:45:00Z';

const AGENDA = `/api/v1/consultorios/${CONSULTORIO}/ofertas/${OFERTA}/agenda`;
const HABILITACIONES = `/api/v1/consultorios/${CONSULTORIO}/ofertas/${OFERTA}/habilitaciones`;
const PERSONAS = '/api/v1/personas';
const RESERVAR = `/api/v1/consultorios/${CONSULTORIO}/turnos/ofertas/${OFERTA}`;

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
        { desde: INICIO, hasta: SIGUIENTE, cupoLibre: 1, cupoTotal: 1, profesionalId: 31 },
        {
          desde: SIGUIENTE,
          hasta: '2026-09-15T13:30:00Z',
          cupoLibre: 1,
          cupoTotal: 1,
          profesionalId: 31,
        },
      ],
    },
  ],
};

const PACIENTE = {
  id: 128,
  apellido: 'Perez',
  nombre: 'Ana',
  esPaciente: true,
  estado: 'ACTIVO',
  version: 0,
};

/**
 * Spec de la reserva (M12, AKINE-05.02).
 *
 * <p>Cubre las dos cosas que deciden comportamiento y nada mas:
 *
 * <ol>
 *   <li><b>La clave de idempotencia.</b> Es lo unico que impide que un doble click cree dos
 *       turnos, y tiene que ser estable dentro del intento y distinta entre intentos. Si se
 *       rompiera, el sintoma seria un turno duplicado en la agenda de un profesional o un 409 que
 *       le echa la culpa a nadie.</li>
 *   <li><b>Los cinco conflictos llevan a cinco acciones distintas.</b> Es el corazon del encargo:
 *       con un rechazo generico el operador queda sin salida en cuatro de los cinco casos.</li>
 * </ol>
 */
describe('ReservaDeTurnoPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReservaDeTurnoPage],
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

  /**
   * Escribir tiene que buscar. Suena obvio y no lo era.
   *
   * <p>El template estaba atado a `(change)`, que sobre un campo de texto <b>solo ocurre al
   * perder el foco</b>. El recepcionista escribia el documento y no pasaba nada: sin peticion,
   * sin resultados y sin ningun sintoma que explicara por que. Se encontro abriendo la pantalla
   * contra el backend real.
   *
   * <p>El test dispara el evento del DOM a proposito, y no llama al metodo. Llamarlo directo es
   * exactamente lo que no veia el defecto: el metodo siempre estuvo bien, lo que estaba mal era
   * quien lo llamaba.
   */
  it('escribir en el buscador dispara la busqueda, sin salir del campo', async () => {
    const fixture = await montar();
    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      '#reserva-persona',
    ) as HTMLInputElement;

    campo.value = '41222333';
    campo.dispatchEvent(new Event('input'));
    await esperarElDebounce();
    fixture.detectChanges();

    const pedido = httpMock.expectOne(
      (p: HttpRequest<unknown>) => p.method === 'GET' && p.url === PERSONAS,
    );
    expect(pedido.request.params.get('q')).toBe('41222333');
    pedido.flush({ content: [PACIENTE], page: 0, size: 10, totalElements: 1, totalPages: 1 });
  });

  it('escribir de a poco consulta el padron UNA sola vez', async () => {
    const fixture = await montar();
    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      '#reserva-persona',
    ) as HTMLInputElement;

    // Con `input` y sin debounce, cada tecla seria una consulta al padron.
    for (const texto of ['4', '41', '412', '4122']) {
      campo.value = texto;
      campo.dispatchEvent(new Event('input'));
    }
    await esperarElDebounce();
    fixture.detectChanges();

    const pedidos = httpMock.match(
      (p: HttpRequest<unknown>) => p.method === 'GET' && p.url === PERSONAS,
    );
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].request.params.get('q')).toBe('4122');
    pedidos[0].flush({ content: [], page: 0, size: 10, totalElements: 0, totalPages: 0 });
  });

  it('muestra el resumen con el horario en la zona de la sede antes de reservar', async () => {
    const fixture = await montar();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(texto).toContain('Kinesiologia deportiva');
    // 12:00Z son las 09:00 en Cordoba: el resumen usa la zona de la respuesta, no la del
    // navegador que mira la pantalla.
    expect(texto).toContain('09:00 a 09:45');
    expect(texto).toContain('America/Argentina/Cordoba');
  });

  it('manda una clave de idempotencia y la REUSA al reintentar el mismo intento', async () => {
    const fixture = await montar();
    await elegirPersona(fixture);

    reservar(fixture);
    const primera = httpMock.expectOne(esReserva());
    const clave = claveDe(primera.request.body);
    expect(clave).not.toBe('');

    // Timeout, doble click, lo que sea: el mismo intento reintentado tiene que llevar la MISMA
    // clave, que es lo que hace que el backend devuelva el turno ya creado en vez de otro.
    primera.flush(
      { type: 'https://akine.app/problems/internal-error', status: 500, detail: 'Se cayo.' },
      { status: 500, statusText: 'Server Error' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    reservar(fixture);
    const segunda = httpMock.expectOne(esReserva());
    expect(claveDe(segunda.request.body)).toBe(clave);

    segunda.flush({ id: 301, estado: 'RESERVADO', inicio: INICIO, fin: SIGUIENTE });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('slot-no-disponible ofrece recargar la agenda, y recargarla vuelve a pedir el dia', async () => {
    const fixture = await montar();
    await elegirPersona(fixture);
    await rechazar(fixture, 'slot-no-disponible', {
      motivo: 'el profesional dejo de atender ese dia',
    });

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Lo que cambio: el profesional dejo de atender ese dia');

    clickear(fixture, 'Recargar la agenda');
    httpMock.expectOne(esAgenda()).flush(DIA);
    httpMock.expectOne(esHabilitaciones()).flush({ profesionales: [] });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('slot-completo ofrece el turno siguiente y arranca un intento nuevo', async () => {
    const fixture = await montar();
    await elegirPersona(fixture);
    await rechazar(fixture, 'slot-completo', { cupoTotal: 1 });

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // No ofrece recargar: el horario existe, lo que se agoto es el cupo.
    expect(texto).not.toContain('Recargar la agenda');
    expect(texto).toContain('Tomar el siguiente: 09:45');

    clickear(fixture, 'Tomar el siguiente');
    reservar(fixture);

    const nueva = httpMock.expectOne(esReserva());
    // Otro horario es otro intento: reusar la clave anterior es lo que el backend rechaza con
    // `idempotency-key-conflict`.
    expect((nueva.request.body as { inicio?: string }).inicio).toBe(SIGUIENTE);
    nueva.flush({ id: 302, estado: 'RESERVADO', inicio: SIGUIENTE });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('recurso-ocupado dice cual recurso y manda a elegir otro horario o profesional', async () => {
    const fixture = await montar();
    await elegirPersona(fixture);
    await rechazar(fixture, 'recurso-ocupado', { recurso: 'profesional' });

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('profesional');
    expect(texto).toContain('Elegir otro horario o profesional');
  });

  it('persona-sin-perfil-paciente ofrece activar el perfil, no recargar la agenda', async () => {
    const fixture = await montar();
    await elegirPersona(fixture);
    await rechazar(fixture, 'persona-sin-perfil-paciente');

    const enlace = (fixture.nativeElement as HTMLElement).querySelector('a[href="/pacientes"]');
    expect(enlace?.textContent).toContain('Activar el perfil de paciente');
  });

  it('idempotency-key-conflict reintenta con una clave NUEVA', async () => {
    const fixture = await montar();
    await elegirPersona(fixture);

    reservar(fixture);
    const primera = httpMock.expectOne(esReserva());
    const clave = claveDe(primera.request.body);
    primera.flush(
      {
        type: 'https://akine.app/problems/idempotency-key-conflict',
        status: 409,
        detail: 'La clave se reuso.',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    clickear(fixture, 'Volver a intentar la reserva');
    const segunda = httpMock.expectOne(esReserva());
    // Reintentar con la misma clave daria el mismo 409 para siempre: la clave se quema.
    expect(claveDe(segunda.request.body)).not.toBe(clave);

    segunda.flush({ id: 303, estado: 'RESERVADO', inicio: INICIO });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('despues de reservar ofrece confirmar, y no ofrece cancelar', async () => {
    const fixture = await montar();
    await elegirPersona(fixture);

    reservar(fixture);
    httpMock
      .expectOne(esReserva())
      .flush({ id: 301, estado: 'RESERVADO', inicio: INICIO, fin: SIGUIENTE });
    await fixture.whenStable();
    fixture.detectChanges();

    clickear(fixture, 'Confirmar el turno');
    httpMock
      .expectOne(
        (p: HttpRequest<unknown>) =>
          p.method === 'POST' &&
          p.url === `/api/v1/consultorios/${CONSULTORIO}/turnos/301/confirmacion`,
      )
      .flush({ id: 301, estado: 'CONFIRMADO', inicio: INICIO, fin: SIGUIENTE });
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Turno confirmado');
    // AKINE-05.03 quedo fuera de alcance por DP-10: no hay endpoint de cancelacion y por eso no
    // hay boton. Un boton que termina en 404 promete algo que el producto no tiene.
    expect(botonPorTexto(fixture, 'Cancelar')).toBeNull();
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  function claveDe(cuerpo: unknown): string {
    return (cuerpo as { idempotencyKey?: string }).idempotencyKey ?? '';
  }

  function esAgenda() {
    return (p: HttpRequest<unknown>) => p.method === 'GET' && p.url === AGENDA;
  }

  function esHabilitaciones() {
    return (p: HttpRequest<unknown>) => p.method === 'GET' && p.url === HABILITACIONES;
  }

  function esReserva() {
    return (p: HttpRequest<unknown>) => p.method === 'POST' && p.url === RESERVAR;
  }

  function botonPorTexto(
    fixture: ComponentFixture<ReservaDeTurnoPage>,
    texto: string,
  ): HTMLButtonElement | null {
    const botones = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ) as HTMLButtonElement[];
    return botones.find((boton) => boton.textContent?.includes(texto)) ?? null;
  }

  function clickear(fixture: ComponentFixture<ReservaDeTurnoPage>, texto: string): void {
    botonPorTexto(fixture, texto)?.click();
    fixture.detectChanges();
  }

  function reservar(fixture: ComponentFixture<ReservaDeTurnoPage>): void {
    clickear(fixture, 'Reservar el turno');
  }

  /** Dispara el rechazo del backend con el tipo pedido y deja la pantalla actualizada. */
  async function rechazar(
    fixture: ComponentFixture<ReservaDeTurnoPage>,
    tipo: string,
    extras: Record<string, unknown> = {},
  ): Promise<void> {
    reservar(fixture);
    httpMock.expectOne(esReserva()).flush(
      {
        type: `https://akine.app/problems/${tipo}`,
        status: 409,
        detail: 'Rechazado.',
        ...extras,
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** El debounce de la busqueda de personas, mas un margen. */
  function esperarElDebounce(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 400));
  }

  async function elegirPersona(fixture: ComponentFixture<ReservaDeTurnoPage>): Promise<void> {
    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      '#reserva-persona',
    ) as HTMLInputElement;
    campo.value = 'Perez';
    // `input` y no `change`: es lo que produce escribir. El helper despachaba `change` —el
    // evento al que el template estaba atado— asi que espejaba el binding en vez de al usuario,
    // y por eso el spec seguia verde con la pantalla muerta. Ver el test de mas abajo.
    campo.dispatchEvent(new Event('input'));
    await esperarElDebounce();
    fixture.detectChanges();

    httpMock
      .expectOne((p: HttpRequest<unknown>) => p.method === 'GET' && p.url === PERSONAS)
      .flush({ content: [PACIENTE], page: 0, size: 10, totalElements: 1, totalPages: 1 });
    await fixture.whenStable();
    fixture.detectChanges();

    clickear(fixture, 'Perez');
  }

  async function montar(): Promise<ComponentFixture<ReservaDeTurnoPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_TURNO_MANAGE] });

    const fixture = TestBed.createComponent(ReservaDeTurnoPage);
    fixture.componentRef.setInput('ofertaId', String(OFERTA));
    fixture.componentRef.setInput('fecha', FECHA);
    fixture.componentRef.setInput('inicio', INICIO);
    fixture.componentRef.setInput('profesionalId', '31');
    fixture.detectChanges();

    httpMock.expectOne(esAgenda()).flush(DIA);
    httpMock
      .expectOne(esHabilitaciones())
      .flush({ profesionales: [{ membershipId: 31, nombre: 'Lopez, Maria', vigenteHoy: true }] });
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }
});
