import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LiquidacionDeHonorariosPage } from './liquidacion-de-honorarios-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const BASE = `/api/v1/consultorios/${CONSULTORIO}`;
const BORRADOR_URL = `${BASE}/honorarios/borrador`;
const LIQUIDACIONES = `${BASE}/honorarios/liquidaciones`;
const HOY = '2026-10-18';

const LINEA_PILATES = {
  claseId: 101,
  fecha: '2026-10-05',
  titulo: 'Pilates lunes',
  ofertaId: 31,
  ofertaNombre: 'Pilates grupal',
  presentes: 2,
  importePorParticipante: 500,
  importeClase: 1000,
  instructores: 2,
  posicion: 1,
  importeColaborador: 500,
  moneda: 'ARS',
};

const LINEA_YOGA = {
  ...LINEA_PILATES,
  claseId: 102,
  titulo: 'Yoga martes',
  ofertaId: 32,
  ofertaNombre: 'Yoga',
  instructores: 1,
  importeColaborador: 1000,
};

const EXCLUIDAS = [
  {
    claseId: 90,
    fecha: '2026-10-02',
    titulo: 'Pilates viernes',
    ofertaNombre: 'Pilates grupal',
    motivo: 'YA_LIQUIDADA',
    egresoId: 600,
  },
  { claseId: 91, fecha: '2026-10-03', ofertaNombre: 'Yoga', motivo: 'SIN_PRESENTES' },
];

function borrador(clases: object[], total: number, excluidas: object[] = EXCLUIDAS) {
  return {
    consultorioId: CONSULTORIO,
    colaboradorMembershipId: 7,
    desde: '2026-10-01',
    hasta: HOY,
    importeTotal: total,
    moneda: 'ARS',
    clases,
    excluidas,
  };
}

/**
 * Liquidacion de honorarios por clase (DP-38). Lo que decide comportamiento: el borrador se pide
 * con el periodo del dia de la sede, cada oferta se confirma por separado con su total exacto y su
 * clave, un borrador desactualizado se relee sin liquidar, y lo excluido dice por que.
 */
describe('LiquidacionDeHonorariosPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LiquidacionDeHonorariosPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(DiaDeLaSede), 'hoy').mockReturnValue(HOY);
  });

  afterEach(() => httpMock.verify());

  it('sin colaborador no pide nada, y el periodo arranca en el mes de la sede', async () => {
    const fixture = await montar();
    expect(campo<HTMLInputElement>(fixture, '#honorarios-desde').value).toBe('2026-10-01');
    expect(campo<HTMLInputElement>(fixture, '#honorarios-hasta').value).toBe(HOY);
    // Solo las grupales: son las que tienen clases.
    expect(texto(fixture)).toContain('Pilates grupal');
    expect(texto(fixture)).not.toContain('Kinesiologia');

    enviarPedido(fixture);
    httpMock.expectNone((p) => p.url === BORRADOR_URL);
    expect(texto(fixture)).toContain('Elegí a quién se le liquida.');

    elegir(fixture, '#honorarios-colaborador', '7');
    escribir(fixture, '#honorarios-hasta', '2026-09-01');
    enviarPedido(fixture);
    httpMock.expectNone((p) => p.url === BORRADOR_URL);
    expect(texto(fixture)).toContain('no puede terminar antes de empezar');
  });

  it('un borrador de una oferta se confirma con clases, total y clave, y enlaza al egreso', async () => {
    const fixture = await montar();
    await pedirBorrador(fixture, borrador([LINEA_PILATES], 500), '31');

    expect(texto(fixture)).toContain('Pilates lunes');
    expect(texto(fixture)).toContain('Parte 1 de 2');
    expect(texto(fixture)).toContain('Ya liquidada a este colaborador');
    expect(texto(fixture)).toContain('Ningún participante presente');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('a[href="/egresos/600"]'),
    ).not.toBeNull();

    escribir(fixture, '#honorarios-concepto', 'Honorarios Pilates octubre');
    boton(fixture, 'Confirmar la liquidación').click();
    const confirmacion = httpMock.expectOne((p) => p.method === 'POST' && p.url === LIQUIDACIONES);
    const cuerpo = confirmacion.request.body as Record<string, unknown>;
    expect(cuerpo).toMatchObject({
      colaboradorMembershipId: 7,
      desde: '2026-10-01',
      hasta: HOY,
      ofertaId: 31,
      claseIds: [101],
      importeTotal: 500,
      concepto: 'Honorarios Pilates octubre',
    });
    expect(typeof cuerpo['idempotencyKey']).toBe('string');
    confirmacion.flush({ id: 77, egresoId: 900, importeTotal: 500, moneda: 'ARS' });
    // Se relee: la clase recien liquidada pasa a excluida.
    responderBorrador(borrador([], 0, [{ ...EXCLUIDAS[0], claseId: 101, egresoId: 900 }]));
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Liquidación #77 confirmada');
    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('a[href="/egresos/900"]')).not.toBeNull();
    expect(html.querySelector('a[href="/egresos/honorarios/liquidaciones/77"]')).not.toBeNull();
    expect(texto(fixture)).toContain('No hay clases para liquidar');
  });

  it('un borrador que mezcla ofertas se confirma oferta por oferta', async () => {
    const fixture = await montar();
    await pedirBorrador(fixture, borrador([LINEA_PILATES, LINEA_YOGA], 1500, []));

    expect(texto(fixture)).toContain('se confirma una por servicio');
    expect(boton(fixture, 'Confirmar la liquidación de Pilates grupal')).toBeTruthy();
    boton(fixture, 'Confirmar la liquidación de Yoga').click();
    const confirmacion = httpMock.expectOne((p) => p.method === 'POST');
    expect(confirmacion.request.body).toMatchObject({
      ofertaId: 32,
      claseIds: [102],
      importeTotal: 1000,
    });
    confirmacion.flush({ id: 78, egresoId: 901, importeTotal: 1000, moneda: 'ARS' });
    responderBorrador(borrador([LINEA_PILATES], 500, []));
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Liquidación #78 confirmada');
    expect(boton(fixture, 'Confirmar la liquidación')).toBeTruthy();
  });

  it('un borrador desactualizado no liquida: lo dice con el importe nuevo y relee', async () => {
    const fixture = await montar();
    await pedirBorrador(fixture, borrador([LINEA_PILATES], 500));
    boton(fixture, 'Confirmar la liquidación').click();
    const primero = httpMock.expectOne((p) => p.method === 'POST');
    const clave = (primero.request.body as { idempotencyKey: string }).idempotencyKey;
    primero.flush(
      {
        type: 'https://akine.app/problems/borrador-de-honorarios-desactualizado',
        status: 409,
        importeTotalActual: 750,
        claseIdsActuales: [101],
      },
      { status: 409, statusText: 'Conflict' },
    );
    responderBorrador(borrador([{ ...LINEA_PILATES, presentes: 3, importeColaborador: 750 }], 750));
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('El borrador cambio desde que lo miraste');
    expect(texto(fixture)).toContain('750,00');

    // El borrador nuevo sale con clave nueva: es otro pedido.
    boton(fixture, 'Confirmar la liquidación').click();
    const segundo = httpMock.expectOne((p) => p.method === 'POST');
    expect(segundo.request.body).toMatchObject({ importeTotal: 750 });
    expect((segundo.request.body as { idempotencyKey: string }).idempotencyKey).not.toBe(clave);
    segundo.flush(
      { type: 'https://akine.app/problems/liquidacion-de-honorarios-vacia', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    responderBorrador(borrador([], 0, []));
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('No queda ninguna clase para liquidar');
  });

  it('un error de red reintenta con la misma clave; una clave reusada la renueva', async () => {
    const fixture = await montar();
    await pedirBorrador(fixture, borrador([LINEA_PILATES], 500));
    boton(fixture, 'Confirmar la liquidación').click();
    const primero = httpMock.expectOne((p) => p.method === 'POST');
    const clave = (primero.request.body as { idempotencyKey: string }).idempotencyKey;
    primero.error(new ProgressEvent('error'), { status: 0 });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('no sabemos si la operación entro');

    boton(fixture, 'Confirmar la liquidación').click();
    const reintento = httpMock.expectOne((p) => p.method === 'POST');
    expect((reintento.request.body as { idempotencyKey: string }).idempotencyKey).toBe(clave);
    reintento.flush(
      { type: 'https://akine.app/problems/idempotency-key-conflict', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);

    boton(fixture, 'Confirmar la liquidación').click();
    const tercero = httpMock.expectOne((p) => p.method === 'POST');
    expect((tercero.request.body as { idempotencyKey: string }).idempotencyKey).not.toBe(clave);
    tercero.flush({ id: 79, egresoId: 902, importeTotal: 500, moneda: 'ARS' });
    responderBorrador(borrador([], 0, []));
    await estabilizar(fixture);
  });

  it('cambiar el pedido saca de pantalla el borrador viejo', async () => {
    const fixture = await montar();
    await pedirBorrador(fixture, borrador([LINEA_PILATES], 500));
    escribir(fixture, '#honorarios-desde', '2026-10-02');
    expect(texto(fixture)).not.toContain('Pilates lunes');
  });

  it('un error al calcular se muestra y se puede reintentar', async () => {
    const fixture = await montar();
    elegir(fixture, '#honorarios-colaborador', '7');
    enviarPedido(fixture);
    httpMock
      .expectOne((p) => p.url === BORRADOR_URL)
      .flush(
        { type: 'https://akine.app/problems/validation-error', status: 400, detail: 'Mal periodo' },
        { status: 400, statusText: 'Bad Request' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Mal periodo');
    boton(fixture, 'Reintentar').click();
    responderBorrador(borrador([], 0, []));
    await estabilizar(fixture);
  });

  it('sin sede manda a elegir contexto', async () => {
    const fixture = TestBed.createComponent(LiquidacionDeHonorariosPage);
    fixture.detectChanges();
    await estabilizar(fixture);
    elegir(fixture, '#honorarios-colaborador', '');
    enviarPedido(fixture);
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Elegir contexto');
  });

  it(
    'no tiene violaciones de accesibilidad con un borrador mixto y excluidas',
    async () => {
      const fixture = await montar();
      await pedirBorrador(fixture, borrador([LINEA_PILATES, LINEA_YOGA], 1500));
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // ------------------------------------------------------------------------------------

  async function montar(): Promise<ComponentFixture<LiquidacionDeHonorariosPage>> {
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
    const fixture = TestBed.createComponent(LiquidacionDeHonorariosPage);
    fixture.detectChanges();
    httpMock
      .expectOne((p) => p.url === '/api/v1/organizations/1/memberships')
      .flush({ content: [{ id: 7, accountName: 'Lic. Sintetica', estado: 'ACTIVA' }] });
    httpMock
      .expectOne((p) => p.url === `${BASE}/ofertas`)
      .flush([
        { id: 31, nombreComercial: 'Pilates grupal', modalidad: 'GRUPAL', estado: 'ACTIVO' },
        { id: 33, nombreComercial: 'Kinesiologia', modalidad: 'INDIVIDUAL', estado: 'ACTIVO' },
      ]);
    await estabilizar(fixture);
    return fixture;
  }

  async function pedirBorrador(
    fixture: ComponentFixture<LiquidacionDeHonorariosPage>,
    respuesta: object,
    oferta = '',
  ): Promise<void> {
    elegir(fixture, '#honorarios-colaborador', '7');
    if (oferta !== '') {
      elegir(fixture, '#honorarios-oferta', oferta);
    }
    enviarPedido(fixture);
    const pedido = httpMock.expectOne((p) => p.url === BORRADOR_URL);
    expect(pedido.request.params.get('colaboradorMembershipId')).toBe('7');
    expect(pedido.request.params.get('desde')).toBe('2026-10-01');
    expect(pedido.request.params.get('hasta')).toBe(HOY);
    expect(pedido.request.params.get('ofertaId')).toBe(oferta === '' ? null : oferta);
    pedido.flush(respuesta);
    await estabilizar(fixture);
  }

  function responderBorrador(respuesta: object): void {
    httpMock.expectOne((p) => p.method === 'GET' && p.url === BORRADOR_URL).flush(respuesta);
  }

  async function estabilizar(fixture: ComponentFixture<unknown>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<unknown>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  function campo<T extends HTMLElement>(fixture: ComponentFixture<unknown>, selector: string): T {
    return (fixture.nativeElement as HTMLElement).querySelector<T>(selector)!;
  }

  function boton(fixture: ComponentFixture<unknown>, etiqueta: string): HTMLButtonElement {
    const encontrado = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === etiqueta);
    if (encontrado === undefined) {
      throw new Error(`no hay botón "${etiqueta}"`);
    }
    return encontrado;
  }

  function elegir(fixture: ComponentFixture<unknown>, selector: string, valor: string): void {
    const select = campo<HTMLSelectElement>(fixture, selector);
    select.value = valor;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribir(fixture: ComponentFixture<unknown>, selector: string, valor: string): void {
    const input = campo<HTMLInputElement>(fixture, selector);
    input.value = valor;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function enviarPedido(fixture: ComponentFixture<unknown>): void {
    (fixture.nativeElement as HTMLElement)
      .querySelector('form')!
      .dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }
});
