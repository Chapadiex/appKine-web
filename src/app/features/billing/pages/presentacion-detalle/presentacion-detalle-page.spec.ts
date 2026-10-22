import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PresentacionDetallePage } from './presentacion-detalle-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const LOTE_ID = 77;
const BASE = `/api/v1/consultorios/${CONSULTORIO}`;
const DETALLE = `${BASE}/presentaciones/${LOTE_ID}`;
const ELEGIBLES = `${BASE}/prestaciones-elegibles`;
const VALIDACION = `${DETALLE}/validacion`;
const PAGOS = `${DETALLE}/pagos`;

const ITEM = {
  id: 501,
  obligacionId: 9001,
  concepto: 'Kinesiologia - sesión',
  estado: 'INCLUIDO',
  importePresentado: 12000,
  personaId: 128,
  fechaPrestacion: '2026-09-10',
};

const BORRADOR = {
  id: LOTE_ID,
  estado: 'BORRADOR',
  financiadorId: 10,
  financiadorNombre: 'OSDE Sintetica',
  periodoDesde: '2026-09-01',
  periodoHasta: '2026-09-30',
  moneda: 'ARS',
  items: [ITEM],
  totalPresentado: 0,
  saldo: 0,
};

const PRESENTADA = {
  ...BORRADOR,
  estado: 'PRESENTADA',
  numero: 12,
  totalPresentado: 12000,
  saldo: 12000,
};

const ITEM_PARCIAL = {
  ...ITEM,
  id: 502,
  obligacionId: 9003,
  estado: 'DEBITADO_PARCIAL',
  importeDebitado: 4000,
  motivoDebito: 'Sesión no autorizada',
};

const LOTE_CON_PARCIALES = {
  ...PRESENTADA,
  items: [ITEM_PARCIAL, ITEM],
  totalPresentado: 24000,
  totalDebitado: 4000,
  saldo: 20000,
};

const ELEGIBLE = {
  id: 9002,
  snapshotNombre: 'Kinesiologia - evaluación',
  personaId: 129,
  saldo: 8000,
  devengadaEn: '2026-09-12T13:00:00Z',
  responsable: 'FINANCIADOR',
  convenio: { convenioNombre: 'Convenio general', requeriaOrden: true, credencialVencida: true },
};

/**
 * Un lote de presentacion de punta a punta (M21). Cubre lo que decide comportamiento: la bandeja
 * de elegibles con los requisitos del convenio, los hallazgos de la revision —incluido
 * `DEUDA_DEL_PACIENTE`—, que cada operacion relea el lote, que confirmar con hallazgos vuelva a
 * mostrar la revision, y que el pago viaje con clave de idempotencia.
 */
describe('PresentacionDetallePage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PresentacionDetallePage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
  });

  afterEach(() => httpMock.verify());

  it('un borrador muestra sus prestaciones, la bandeja y los hallazgos de la revision', async () => {
    const fixture = await montarBorrador({
      confirmable: false,
      hallazgos: [{ itemId: 501, obligacionId: 9001, hallazgo: 'DEUDA_DEL_PACIENTE' }],
    });

    const texto = contenido(fixture);
    expect(texto).toContain('Lote en borrador a OSDE Sintetica');
    expect(texto).toContain('Kinesiologia - sesión');
    expect(texto).toContain('12.000,00');
    // La bandeja trae el periodo del lote y los requisitos del convenio.
    expect(texto).toContain('Kinesiologia - evaluación');
    expect(texto).toContain('El convenio exige orden.');
    expect(texto).toContain('La credencial estaba vencida.');
    // El hallazgo se marca en el item y en la lista de la revision.
    expect(texto).toContain('Observada:');
    expect(texto).toContain('Es deuda del paciente');
    expect(texto).toContain('1 observación(es)');
  });

  it('agregar y quitar mandan la operación y releen el lote entero', async () => {
    const fixture = await montarBorrador({ confirmable: true, hallazgos: [] });

    apretar(fixture, 'Agregar la deuda 9002');
    const alta = httpMock.expectOne(`${DETALLE}/items`);
    expect(alta.request.method).toBe('POST');
    expect(alta.request.body).toEqual({ obligacionId: 9002 });
    alta.flush({ id: 502 });
    await responderBorrador(fixture, { ...BORRADOR, items: [ITEM, { ...ITEM, id: 502 }] }, []);
    expect(contenido(fixture)).toContain('Se agrego la prestación al lote.');

    apretarPrimero(fixture, 'Quitar');
    const baja = httpMock.expectOne(`${DETALLE}/items/501`);
    expect(baja.request.method).toBe('DELETE');
    baja.flush(null);
    await responderBorrador(fixture, BORRADOR, [ELEGIBLE]);
    expect(contenido(fixture)).toContain('Vuelve a estar disponible');
  });

  it('confirmar con hallazgos muestra el error del servidor y vuelve a pedir la revision', async () => {
    const fixture = await montarBorrador({ confirmable: true, hallazgos: [] });

    apretar(fixture, 'Confirmar y presentar');
    httpMock.expectOne(`${DETALLE}/confirmacion`).flush(
      {
        type: 'https://akine.app/problems/presentacion-con-hallazgos',
        status: 409,
        detail: 'El lote tiene 1 prestación que no se puede reclamar.',
      },
      { status: 409, statusText: 'Conflict' },
    );
    httpMock
      .expectOne(VALIDACION)
      .flush({ confirmable: false, hallazgos: [{ itemId: 501, hallazgo: 'SIN_SALDO' }] });
    await estabilizar(fixture);

    const texto = contenido(fixture);
    expect(texto).toContain('El lote tiene 1 prestación que no se puede reclamar.');
    expect(texto).toContain('La deuda ya no tiene saldo');
  });

  it('descartar el borrador exige motivo y lo manda', async () => {
    const fixture = await montarBorrador({ confirmable: true, hallazgos: [] });

    apretar(fixture, 'Descartar el borrador');
    escribir(fixture, '#anular-presentacion-motivo', 'Armado por error');
    apretar(fixture, 'Descartar');

    const anulacion = httpMock.expectOne(`${DETALLE}/anulacion`);
    expect(anulacion.request.body).toEqual({ motivo: 'Armado por error' });
    anulacion.flush({ ...BORRADOR, estado: 'ANULADA' });
    httpMock
      .expectOne(DETALLE)
      .flush({ ...BORRADOR, estado: 'ANULADA', motivoAnulacion: 'Armado por error' });
    await estabilizar(fixture);

    expect(contenido(fixture)).toContain('Anulada');
    expect(contenido(fixture)).toContain('Armado por error');
  });

  it('un lote presentado registra el pago con clave de idempotencia y relee', async () => {
    const fixture = await montarPresentada();

    escribir(fixture, '#pago-importe', '5000');
    escribir(fixture, '#pago-referencia', 'trf-123');
    enviarFormulario(fixture, '#pago-importe');

    const pago = httpMock.expectOne((p) => p.method === 'POST' && p.url === PAGOS);
    expect(pago.request.body).toMatchObject({
      importe: 5000,
      medio: 'TRANSFERENCIA',
      referencia: 'trf-123',
    });
    expect(typeof pago.request.body.idempotencyKey).toBe('string');
    pago.flush({ id: 1 });
    httpMock.expectOne(DETALLE).flush({ ...PRESENTADA, totalCobrado: 5000, saldo: 7000 });
    httpMock
      .expectOne((p) => p.method === 'GET' && p.url === PAGOS)
      .flush([
        {
          id: 1,
          fechaPago: '2026-10-01',
          medio: 'TRANSFERENCIA',
          importe: 5000,
          referencia: 'trf-123',
        },
      ]);
    await estabilizar(fixture);

    const texto = contenido(fixture);
    expect(texto).toContain('Pago registrado');
    expect(texto).toContain('7.000,00');
    expect(texto).toContain('ref. trf-123');
  });

  it('registra el debito de una prestación y la factura del lote', async () => {
    const fixture = await montarPresentada();

    apretar(fixture, 'Registrar débito');
    escribir(fixture, '#debito-motivo', 'Falta orden medica');
    enviarFormulario(fixture, '#debito-motivo');
    const debito = httpMock.expectOne(`${DETALLE}/items/501/debito`);
    expect(debito.request.body).toEqual({ importe: 12000, motivo: 'Falta orden medica' });
    debito.flush({});
    httpMock.expectOne(DETALLE).flush(PRESENTADA);
    httpMock.expectOne((p) => p.method === 'GET' && p.url === PAGOS).flush([]);
    await estabilizar(fixture);
    expect(contenido(fixture)).toContain('Debito registrado');

    escribir(fixture, '#factura-numero', '0001-00000042');
    enviarFormulario(fixture, '#factura-numero');
    const factura = httpMock.expectOne(`${DETALLE}/factura`);
    expect(factura.request.body.numero).toBe('0001-00000042');
    factura.flush({});
    httpMock.expectOne(DETALLE).flush({ ...PRESENTADA, estado: 'FACTURADA' });
    httpMock.expectOne((p) => p.method === 'GET' && p.url === PAGOS).flush([]);
    await estabilizar(fixture);
    expect(contenido(fixture)).toContain('Facturada');
  });

  it('cerrar con saldo pendiente muestra el residual que informa el servidor', async () => {
    const fixture = await montarPresentada();

    apretar(fixture, 'Cerrar (conciliar) el lote');
    httpMock.expectOne(`${DETALLE}/conciliacion`).flush(
      {
        type: 'https://akine.app/problems/presentacion-no-concilia',
        status: 409,
        detail: 'Quedan 12000.00 sin explicar.',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);

    expect(contenido(fixture)).toContain('Quedan 12000.00 sin explicar.');
  });

  it('exportar baja el CSV con el nombre de Content-Disposition y revoca el objectURL', async () => {
    const fixture = await montarPresentada();
    const urlGlobal = URL as unknown as Record<string, unknown>;
    const crearPrevio = urlGlobal['createObjectURL'];
    const revocarPrevio = urlGlobal['revokeObjectURL'];
    const revocar = vi.fn();
    urlGlobal['createObjectURL'] = vi.fn(() => 'blob:sintetico');
    urlGlobal['revokeObjectURL'] = revocar;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    try {
      apretar(fixture, 'Exportar CSV');
      const pedido = httpMock.expectOne(`${DETALLE}/export`);
      expect(pedido.request.headers.get('Accept')).toBe('text/csv');
      pedido.flush('item;importe\n501;12000.00\n', {
        headers: { 'Content-Disposition': 'attachment; filename="presentacion-12.csv"' },
      });
      await estabilizar(fixture);

      const enlace = click.mock.contexts[0] as HTMLAnchorElement;
      expect(enlace.download).toBe('presentacion-12.csv');
      expect(revocar).toHaveBeenCalledWith('blob:sintetico');
    } finally {
      urlGlobal['createObjectURL'] = crearPrevio;
      urlGlobal['revokeObjectURL'] = revocarPrevio;
      click.mockRestore();
    }
  });

  it('un error al exportar se muestra con el mensaje del servidor', async () => {
    const fixture = await montarPresentada();

    apretar(fixture, 'Exportar CSV');
    httpMock.expectOne(`${DETALLE}/export`).flush(
      JSON.stringify({
        type: 'https://akine.app/problems/forbidden',
        status: 403,
        detail: 'Sin cobro:register en esa sede.',
      }),
      { status: 403, statusText: 'Forbidden' },
    );
    await estabilizar(fixture);

    expect(contenido(fixture)).toContain('No se pudo completar la operación');
  });

  it(
    'no tiene violaciones de accesibilidad en un borrador con hallazgos',
    async () => {
      const fixture = await montarBorrador({
        confirmable: false,
        hallazgos: [{ itemId: 501, obligacionId: 9001, hallazgo: 'DEUDA_DEL_PACIENTE' }],
      });
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // ---------------------------- DP-37: reparos documentales y avisos -------------------

  it('un reparo SIN_ORDEN bloquea confirmar y el aviso de credencial va aparte', async () => {
    const fixture = await montarBorrador({
      confirmable: false,
      hallazgos: [{ itemId: 501, obligacionId: 9001, hallazgo: 'SIN_ORDEN' }],
      avisos: [{ itemId: 501, obligacionId: 9001, hallazgo: 'CREDENCIAL_FALTANTE' }],
    });

    const texto = contenido(fixture);
    expect(texto).toContain('Observada: El convenio exigia orden medica');
    expect(texto).toContain('Cargala en la ficha del paciente');
    expect(texto).toContain('Aviso: La credencial estaba vencida');
    expect(texto).toContain('1 observación(es) que impiden confirmar');
    expect(texto).toContain('1 aviso(s): no impiden confirmar');
    expect(botones(fixture, 'Confirmar y presentar')[0].disabled).toBe(true);
  });

  it('un lote con solo avisos se puede confirmar: manda confirmable', async () => {
    const fixture = await montarBorrador({
      confirmable: true,
      hallazgos: [],
      avisos: [{ itemId: 501, obligacionId: 9001, hallazgo: 'CREDENCIAL_FALTANTE' }],
    });

    expect(contenido(fixture)).toContain('Ninguna prestación tiene observaciones.');
    expect(contenido(fixture)).toContain('1 aviso(s)');
    const confirmar = botones(fixture, 'Confirmar y presentar')[0];
    expect(confirmar.disabled).toBe(false);

    confirmar.click();
    fixture.detectChanges();
    httpMock.expectOne(`${DETALLE}/confirmacion`).flush({ ...PRESENTADA });
    httpMock.expectOne(DETALLE).flush(PRESENTADA);
    httpMock.expectOne((p) => p.method === 'GET' && p.url === PAGOS).flush([]);
    await estabilizar(fixture);
    expect(contenido(fixture)).toContain('Lote presentado');
  });

  it('el 409 presentacion-con-hallazgos puede traer SIN_AUTORIZACION', async () => {
    const fixture = await montarBorrador({ confirmable: true, hallazgos: [] });

    apretar(fixture, 'Confirmar y presentar');
    httpMock
      .expectOne(`${DETALLE}/confirmacion`)
      .flush(
        { type: 'https://akine.app/problems/presentacion-con-hallazgos', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    httpMock.expectOne(VALIDACION).flush({
      confirmable: false,
      hallazgos: [{ itemId: 501, obligacionId: 9001, hallazgo: 'SIN_AUTORIZACION' }],
      avisos: [],
    });
    await estabilizar(fixture);

    const texto = contenido(fixture);
    expect(texto).toContain('les falta la orden o la autorización que el convenio exigia');
    expect(texto).toContain('El convenio exigia autorización');
    expect(botones(fixture, 'Confirmar y presentar')[0].disabled).toBe(true);
  });

  it('una deuda PARCIAL en la bandeja vuelve por el saldo de un débito parcial', async () => {
    const fixture = crear();
    httpMock.expectOne(DETALLE).flush(BORRADOR);
    httpMock
      .expectOne((p) => p.url === ELEGIBLES)
      .flush([{ ...ELEGIBLE, estado: 'PARCIAL', saldo: 2000 }]);
    httpMock.expectOne(VALIDACION).flush({ confirmable: true, hallazgos: [], avisos: [] });
    await estabilizar(fixture);

    expect(contenido(fixture)).toContain('vuelve por el saldo que dejó un débito parcial');
    expect(contenido(fixture)).toContain('2.000,00');
  });

  // ---------------------------- DP-37: debito parcial ---------------------------------

  it('los estados parciales se ven con su pastilla, su detalle y se pueden filtrar', async () => {
    const fixture = crear();
    httpMock.expectOne(DETALLE).flush(LOTE_CON_PARCIALES);
    httpMock.expectOne((p) => p.method === 'GET' && p.url === PAGOS).flush([]);
    await estabilizar(fixture);

    const anfitrion = fixture.nativeElement as HTMLElement;
    const pastillas = Array.from(anfitrion.querySelectorAll('td span.marca-estado')).map((s) => [
      (s.textContent ?? '').trim(),
      s.className,
    ]);
    expect(pastillas).toEqual([
      ['Debitada en parte', 'marca-estado marca-estado--suspendida'],
      ['Incluida', 'marca-estado marca-estado--suspendida'],
    ]);
    const texto = contenido(fixture);
    expect(texto).toContain('Sigue en el lote: al cerrarlo se salda lo presentado menos lo');
    expect(texto).toContain('Debitado');
    expect(texto).toContain('4.000,00');
    expect(texto).toContain('Débito: Sesión no autorizada');
    // Solo lo INCLUIDO se puede debitar: el parcial ya tiene su debito.
    expect(botones(fixture, 'Registrar débito')).toHaveLength(1);

    filtrar(fixture, 'DEBITADO_PARCIAL');
    expect(anfitrion.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(contenido(fixture)).toContain('Debitada en parte');

    filtrar(fixture, 'ACEPTADO_PARCIAL');
    expect(contenido(fixture)).toContain('Ninguna prestación del lote está en ese estado.');

    filtrar(fixture, '');
    expect(anfitrion.querySelectorAll('.tabla tbody tr')).toHaveLength(2);
  });

  it('un lote conciliado muestra lo aceptado en parte con lo que quedo pendiente', async () => {
    const fixture = crear();
    httpMock.expectOne(DETALLE).flush({
      ...LOTE_CON_PARCIALES,
      estado: 'CONCILIADA',
      items: [
        { ...ITEM_PARCIAL, estado: 'ACEPTADO_PARCIAL' },
        { ...ITEM, estado: 'DEBITADO', importeDebitado: 12000, motivoDebito: 'Duplicada' },
      ],
    });
    httpMock.expectOne((p) => p.method === 'GET' && p.url === PAGOS).flush([]);
    await estabilizar(fixture);

    const texto = contenido(fixture);
    expect(texto).toContain('Aceptada en parte');
    expect(texto).toContain('Se cobro lo presentado menos lo debitado');
    expect(texto).toContain('Salio del lote');
    const clases = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('td span.marca-estado'),
    ).map((s) => s.className);
    expect(clases).toEqual([
      'marca-estado marca-estado--activa',
      'marca-estado marca-estado--revocada',
    ]);
  });

  it('conciliar avisa que lo debitado en parte queda pendiente', async () => {
    const fixture = await montarPresentada();

    apretar(fixture, 'Cerrar (conciliar) el lote');
    httpMock.expectOne(`${DETALLE}/conciliacion`).flush({});
    httpMock.expectOne(DETALLE).flush({ ...PRESENTADA, estado: 'CONCILIADA' });
    httpMock.expectOne((p) => p.method === 'GET' && p.url === PAGOS).flush([]);
    await estabilizar(fixture);

    expect(contenido(fixture)).toContain('las debitadas en parte, por lo presentado menos lo');
  });

  it(
    'no tiene violaciones de accesibilidad con avisos y estados parciales',
    async () => {
      const fixture = await montarBorrador({
        confirmable: false,
        hallazgos: [{ itemId: 501, obligacionId: 9001, hallazgo: 'SIN_AUTORIZACION' }],
        avisos: [{ itemId: 501, obligacionId: 9001, hallazgo: 'CREDENCIAL_FALTANTE' }],
      });
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // ------------------------------------------------------------------------------------

  function filtrar(fixture: ComponentFixture<PresentacionDetallePage>, valor: string): void {
    const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      '#filtro-estado-item',
    )!;
    select.value = valor;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  // ------------------------------------------------------------------------------------

  function crear(): ComponentFixture<PresentacionDetallePage> {
    const fixture = TestBed.createComponent(PresentacionDetallePage);
    fixture.componentRef.setInput('presentacionId', String(LOTE_ID));
    fixture.detectChanges();
    return fixture;
  }

  async function montarBorrador(
    validacion: object,
  ): Promise<ComponentFixture<PresentacionDetallePage>> {
    const fixture = crear();
    httpMock.expectOne(DETALLE).flush(BORRADOR);
    const elegibles = httpMock.expectOne((p) => p.url === ELEGIBLES);
    expect(elegibles.request.params.get('financiadorId')).toBe('10');
    expect(elegibles.request.params.get('desde')).toBe('2026-09-01');
    elegibles.flush([ELEGIBLE]);
    httpMock.expectOne(VALIDACION).flush(validacion);
    await estabilizar(fixture);
    return fixture;
  }

  async function responderBorrador(
    fixture: ComponentFixture<PresentacionDetallePage>,
    lote: object,
    elegibles: object[],
  ): Promise<void> {
    httpMock.expectOne(DETALLE).flush(lote);
    httpMock.expectOne((p) => p.url === ELEGIBLES).flush(elegibles);
    httpMock.expectOne(VALIDACION).flush({ confirmable: true, hallazgos: [] });
    await estabilizar(fixture);
  }

  async function montarPresentada(): Promise<ComponentFixture<PresentacionDetallePage>> {
    const fixture = crear();
    httpMock.expectOne(DETALLE).flush(PRESENTADA);
    httpMock.expectOne((p) => p.method === 'GET' && p.url === PAGOS).flush([]);
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<PresentacionDetallePage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function contenido(fixture: ComponentFixture<PresentacionDetallePage>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  function botones(fixture: ComponentFixture<PresentacionDetallePage>, rotulo: string) {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).filter(
      (b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === rotulo,
    );
  }

  function apretar(fixture: ComponentFixture<PresentacionDetallePage>, rotulo: string): void {
    const encontrados = botones(fixture, rotulo);
    if (encontrados.length !== 1) {
      throw new Error(`Hay ${encontrados.length} botones rotulados "${rotulo}".`);
    }
    encontrados[0].click();
    fixture.detectChanges();
  }

  function apretarPrimero(fixture: ComponentFixture<PresentacionDetallePage>, rotulo: string) {
    botones(fixture, rotulo)[0].click();
    fixture.detectChanges();
  }

  function escribir(
    fixture: ComponentFixture<PresentacionDetallePage>,
    selector: string,
    valor: string,
  ): void {
    const campo = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(selector)!;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function enviarFormulario(fixture: ComponentFixture<PresentacionDetallePage>, campo: string) {
    const form = (fixture.nativeElement as HTMLElement).querySelector(campo)!.closest('form')!;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }
});
