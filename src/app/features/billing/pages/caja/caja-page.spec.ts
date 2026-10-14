import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CajaPage } from './caja-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const JORNADA_ID = 77;
const BASE = `/api/v1/consultorios/${CONSULTORIO}/caja`;

const JORNADA = {
  id: JORNADA_ID,
  consultorioId: CONSULTORIO,
  estado: 'ABIERTA',
  moneda: 'ARS',
  fechaNegocio: '2026-10-07',
  abiertaEn: '2026-10-07T11:00:00Z',
  saldoInicial: 1000,
  saldoTeorico: 1500.5,
  totalesPorMedio: [
    { medio: 'EFECTIVO', total: 500.5, afectaArqueo: true },
    { medio: 'TARJETA_DEBITO', total: 2000, afectaArqueo: false },
  ],
};

const MANUAL = {
  id: 501,
  jornadaCajaId: JORNADA_ID,
  tipo: 'INGRESO',
  tipoOrigen: 'MANUAL',
  medio: 'EFECTIVO',
  importe: 500.5,
  moneda: 'ARS',
  concepto: 'Cambio para el dia',
  registradoEn: '2026-10-07T11:05:00Z',
};

const DE_COBRO = {
  id: 502,
  jornadaCajaId: JORNADA_ID,
  tipo: 'INGRESO',
  tipoOrigen: 'COBRO',
  medio: 'TARJETA_DEBITO',
  importe: 2000,
  moneda: 'ARS',
  concepto: 'Cobro N.º 14',
  registradoEn: '2026-10-07T12:00:00Z',
};

/**
 * Spec de la caja diaria (M20, AKINE-07.03).
 *
 * <p>Cubre lo que decide comportamiento: encontrar la jornada abierta, abrir, cargar un
 * movimiento con clave de idempotencia, revertir solo lo manual, y el arqueo — el motivo cuando
 * no cuadra y el 409 cuando el teorico cambio mientras se contaba.
 */
describe('CajaPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CajaPage],
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

  afterEach(() => {
    httpMock.verify();
  });

  it('sin jornada abierta ofrece abrir la caja y manda el saldo contado', async () => {
    const fixture = await montarCerrada();
    expect(texto(fixture)).toContain('La caja esta cerrada');

    tipear(fixture, '#apertura-saldo', '250,5');
    apretar(fixture, 'Abrir la caja');

    const pedido = httpMock.expectOne((p) => p.method === 'POST' && p.url === `${BASE}/jornadas`);
    expect(pedido.request.body).toEqual({ moneda: 'ARS', saldoInicial: 250.5 });
    pedido.flush(JORNADA);

    await responderAbierta(fixture, []);
    expect(texto(fixture)).toContain('Caja abierta.');
    expect(texto(fixture)).toContain('Todavia no hay movimientos');
  });

  it('con jornada abierta muestra el teorico, el desglose y los movimientos', async () => {
    const fixture = await montarAbierta([MANUAL, DE_COBRO]);

    const contenido = texto(fixture);
    expect(contenido).toContain('1.500,50');
    expect(contenido).toContain('Tarjeta de debito');
    expect(contenido).toContain('Cambio para el dia');
    expect(contenido).toContain('Cobro N.º 14');
    // Solo el manual se revierte desde aca: el de un cobro se anula desde el cobro.
    expect(botones(fixture, 'Revertir')).toHaveLength(1);
  });

  it('registra un movimiento manual con clave de idempotencia y relee la caja', async () => {
    const fixture = await montarAbierta([]);

    elegir(fixture, '#movimiento-tipo', 'EGRESO');
    tipear(fixture, '#movimiento-importe', '100');
    tipear(fixture, '#movimiento-concepto', 'Articulos de limpieza');
    apretar(fixture, 'Registrar el movimiento');

    const pedido = httpMock.expectOne(
      (p) => p.method === 'POST' && p.url === `${BASE}/movimientos`,
    );
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(cuerpo['tipo']).toBe('EGRESO');
    expect(cuerpo['medio']).toBe('EFECTIVO');
    expect(cuerpo['importe']).toBe(100);
    expect(cuerpo['concepto']).toBe('Articulos de limpieza');
    expect(typeof cuerpo['idempotencyKey']).toBe('string');
    pedido.flush({ ...MANUAL, id: 600, tipo: 'EGRESO' });

    await recargarAbierta(fixture, []);
    expect(texto(fixture)).toContain('Movimiento registrado.');
  });

  it('un egreso que deja el cajon en negativo muestra el rechazo y no relee', async () => {
    const fixture = await montarAbierta([]);

    tipear(fixture, '#movimiento-importe', '99999');
    tipear(fixture, '#movimiento-concepto', 'Retiro');
    apretar(fixture, 'Registrar el movimiento');

    httpMock
      .expectOne((p) => p.method === 'POST' && p.url === `${BASE}/movimientos`)
      .flush(
        { type: 'https://akine.app/problems/caja-saldo-insuficiente', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('deja el cajon en negativo');
  });

  it('revertir exige motivo y lo manda', async () => {
    const fixture = await montarAbierta([MANUAL]);

    apretar(fixture, 'Revertir');
    expect(boton(fixture, 'Confirmar la reversion').disabled).toBe(true);

    tipear(fixture, `#motivo-reversion-${MANUAL.id}`, 'Cargado dos veces');
    apretar(fixture, 'Confirmar la reversion');

    const pedido = httpMock.expectOne(
      (p) => p.method === 'POST' && p.url === `${BASE}/movimientos/${MANUAL.id}/reversion`,
    );
    expect(pedido.request.body).toEqual({ motivo: 'Cargado dos veces' });
    pedido.flush({
      ...MANUAL,
      id: 503,
      tipo: 'REVERSION_DE_INGRESO',
      tipoOrigen: 'REVERSION',
      movimientoOrigenId: MANUAL.id,
      motivo: 'Cargado dos veces',
    });

    await recargarAbierta(fixture, [
      MANUAL,
      {
        ...MANUAL,
        id: 503,
        tipo: 'REVERSION_DE_INGRESO',
        tipoOrigen: 'REVERSION',
        movimientoOrigenId: MANUAL.id,
      },
    ]);
    expect(texto(fixture)).toContain('Revertido');
    expect(botones(fixture, 'Revertir')).toHaveLength(0);
  });

  it('un arqueo que no cuadra pide motivo y manda el teorico que se mostraba', async () => {
    const fixture = await montarAbierta([]);

    tipear(fixture, '#cierre-declarado', '1400');
    expect(texto(fixture)).toContain('Diferencia contra el teorico');
    expect(boton(fixture, 'Cerrar la caja').disabled).toBe(true);

    tipear(fixture, '#cierre-motivo', 'Vuelto mal dado');
    apretar(fixture, 'Cerrar la caja');

    const pedido = httpMock.expectOne(
      (p) => p.method === 'POST' && p.url === `${BASE}/jornadas/${JORNADA_ID}/cierre`,
    );
    expect(pedido.request.body).toEqual({
      saldoDeclarado: 1400,
      saldoTeoricoEsperado: 1500.5,
      motivoDiferencia: 'Vuelto mal dado',
    });
    pedido.flush({
      ...JORNADA,
      estado: 'CERRADA',
      saldoDeclarado: 1400,
      saldoTeoricoCierre: 1500.5,
      diferencia: -100.5,
      motivoDiferencia: 'Vuelto mal dado',
    });
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('Arqueo registrado');
    expect(contenido).toContain('Faltante de');
    expect(contenido).toContain('La caja esta cerrada');
  });

  it('si el teorico cambio mientras se contaba, no cierra y ofrece recargar', async () => {
    const fixture = await montarAbierta([]);

    tipear(fixture, '#cierre-declarado', '1500,50');
    expect(texto(fixture)).toContain('coincide con el teorico');
    apretar(fixture, 'Cerrar la caja');

    const pedido = httpMock.expectOne(
      (p) => p.method === 'POST' && p.url === `${BASE}/jornadas/${JORNADA_ID}/cierre`,
    );
    expect((pedido.request.body as Record<string, unknown>)['motivoDiferencia']).toBeUndefined();
    pedido.flush(
      { type: 'https://akine.app/problems/caja-saldo-cambio', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('el saldo teorico cambio');
    apretar(fixture, 'Recargar la caja');
    await recargarAbierta(fixture, []);
  });

  it('sin sede en el contexto no pide nada y manda al selector', async () => {
    const fixture = TestBed.createComponent(CajaPage);
    fixture.detectChanges();
    await estabilizar(fixture);

    httpMock.expectNone(() => true);
    expect(texto(fixture)).toContain('Eligi una organizacion');
  });

  it('si la carga falla ofrece reintentar', async () => {
    seleccionarSede();
    const fixture = TestBed.createComponent(CajaPage);
    fixture.detectChanges();
    httpMock
      .expectOne(esJornadaAbierta)
      .flush({ status: 500 }, { status: 500, statusText: 'Server Error' });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No se pudo cargar la caja');
    apretar(fixture, 'Reintentar');
    httpMock.expectOne(esJornadaAbierta).flush([]);
  });

  it(
    'no tiene violaciones de accesibilidad con la caja abierta y una reversion en curso',
    async () => {
      const fixture = await montarAbierta([MANUAL, DE_COBRO]);
      apretar(fixture, 'Revertir');
      tipear(fixture, '#cierre-declarado', '10');
      await estabilizar(fixture);

      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  function seleccionarSede(): void {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
  }

  async function montarCerrada(): Promise<ComponentFixture<CajaPage>> {
    seleccionarSede();
    const fixture = TestBed.createComponent(CajaPage);
    fixture.detectChanges();
    httpMock.expectOne(esJornadaAbierta).flush([]);
    await estabilizar(fixture);
    return fixture;
  }

  async function montarAbierta(movimientos: object[]): Promise<ComponentFixture<CajaPage>> {
    seleccionarSede();
    const fixture = TestBed.createComponent(CajaPage);
    fixture.detectChanges();
    await recargarAbierta(fixture, movimientos);
    return fixture;
  }

  async function recargarAbierta(
    fixture: ComponentFixture<CajaPage>,
    movimientos: object[],
  ): Promise<void> {
    httpMock.expectOne(esJornadaAbierta).flush([{ ...JORNADA, totalesPorMedio: [] }]);
    await responderAbierta(fixture, movimientos);
  }

  async function responderAbierta(
    fixture: ComponentFixture<CajaPage>,
    movimientos: object[],
  ): Promise<void> {
    // Despues de abrir, la pantalla relee la jornada abierta antes de pedir el detalle.
    httpMock
      .match((p) => p.method === 'GET' && p.url === `${BASE}/jornadas`)
      .forEach((p) => p.flush([{ ...JORNADA, totalesPorMedio: [] }]));
    httpMock
      .expectOne((p) => p.method === 'GET' && p.url === `${BASE}/jornadas/${JORNADA_ID}`)
      .flush(JORNADA);
    httpMock
      .expectOne((p) => p.method === 'GET' && p.url === `${BASE}/movimientos`)
      .flush(movimientos);
    await estabilizar(fixture);
  }

  async function estabilizar(fixture: ComponentFixture<CajaPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function esJornadaAbierta(p: HttpRequest<unknown>): boolean {
    return (
      p.method === 'GET' && p.url === `${BASE}/jornadas` && p.params.get('estado') === 'ABIERTA'
    );
  }

  function botones(fixture: ComponentFixture<CajaPage>, rotulo: string): HTMLButtonElement[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).filter((b) => (b.textContent ?? '').trim() === rotulo);
  }

  function boton(fixture: ComponentFixture<CajaPage>, rotulo: string): HTMLButtonElement {
    const [encontrado] = botones(fixture, rotulo);
    if (encontrado === undefined) {
      throw new Error(`No hay ningun boton rotulado "${rotulo}".`);
    }
    return encontrado;
  }

  function apretar(fixture: ComponentFixture<CajaPage>, rotulo: string): void {
    boton(fixture, rotulo).click();
    fixture.detectChanges();
  }

  function tipear(fixture: ComponentFixture<CajaPage>, selector: string, valor: string): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function elegir(fixture: ComponentFixture<CajaPage>, selector: string, valor: string): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLSelectElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<CajaPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }
});
