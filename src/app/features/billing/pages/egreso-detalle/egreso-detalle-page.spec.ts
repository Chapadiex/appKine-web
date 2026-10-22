import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { EgresoDetallePage } from './egreso-detalle-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const EGRESO_ID = 41;
const BASE = `/api/v1/consultorios/${CONSULTORIO}`;
const DETALLE = `${BASE}/egresos/${EGRESO_ID}`;
const JORNADAS = `${BASE}/caja/jornadas`;
const OFERTAS = [
  { id: 31, nombreComercial: 'Pilates grupal', estado: 'ACTIVO' },
  { id: 32, nombreComercial: 'Yoga', estado: 'ACTIVO' },
  { id: 33, nombreComercial: 'Funcional', estado: 'INACTIVO' },
];

const BORRADOR = {
  id: EGRESO_ID,
  estado: 'BORRADOR',
  tipoBeneficiario: 'EXTERNO',
  beneficiarioNombre: 'Inmobiliaria Sintetica',
  beneficiarioDocumento: '30-00000000-1',
  categoria: 'ALQUILER',
  concepto: 'Alquiler octubre',
  importeTotal: 300000,
  saldoPendiente: 300000,
  moneda: 'ARS',
  pagos: [],
  version: 3,
};

const CONFIRMADO = {
  ...BORRADOR,
  estado: 'CONFIRMADO',
  comprobanteTipo: 'Factura C',
  comprobanteNumero: '0001-00000042',
};

const PAGO = {
  id: 501,
  egresoId: EGRESO_ID,
  estado: 'CONFIRMADO',
  importe: 100000,
  medio: 'EFECTIVO',
  moneda: 'ARS',
  pagadoEn: '2026-10-11T15:00:00Z',
};

function problema(tipo: string, status = 409) {
  return [
    { type: `https://akine.app/problems/${tipo}`, status, detail: 'detalle' },
    { status, statusText: 'Error' },
  ] as const;
}

/**
 * Detalle de un egreso (M22). Cubre lo que decide comportamiento: confirmar exige comprobante y el
 * borrador se corrige sin tocar el beneficiario; el pago propone el saldo, avisa el estado de la
 * caja con efectivo y manda su clave; un rechazo de caja ofrece ir a la caja; y un egreso con
 * pagos vigentes se anula pago por pago.
 */
describe('EgresoDetallePage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EgresoDetallePage],
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

  it('un borrador sin comprobante no se confirma hasta guardarlo, sin tocar el beneficiario', async () => {
    const fixture = await montar(BORRADOR);
    expect(contenido(fixture)).toContain('Todavía falta el comprobante');
    expect(boton(fixture, 'Confirmar el egreso').disabled).toBe(true);
    expect(campo<HTMLInputElement>(fixture, '#edicion-importe').value).toBe('300000.00');

    escribir(fixture, '#edicion-comprobante-tipo', 'Factura C');
    escribir(fixture, '#edicion-comprobante-numero', '0001-00000042');
    enviar(fixture, 0);

    const edicion = httpMock.expectOne((p) => p.method === 'PUT' && p.url === DETALLE);
    // EditarEgreso (contrato 0.92.0): la version leida, y nada de beneficiario, moneda ni clave.
    expect(edicion.request.body).toEqual({
      version: 3,
      categoria: 'ALQUILER',
      concepto: 'Alquiler octubre',
      importeTotal: 300000,
      comprobanteTipo: 'Factura C',
      comprobanteNumero: '0001-00000042',
    });
    // La respuesta trae la version nueva y se aplica sin releer.
    edicion.flush({
      ...BORRADOR,
      comprobanteTipo: 'Factura C',
      comprobanteNumero: '1',
      version: 4,
    });
    await estabilizar(fixture);
    expect(contenido(fixture)).toContain('Cambios guardados');

    // Una segunda correccion sale con la version de la respuesta, no con la leida al entrar.
    escribir(fixture, '#edicion-concepto', 'Alquiler octubre corregido');
    enviar(fixture, 0);
    const segunda = httpMock.expectOne((p) => p.method === 'PUT' && p.url === DETALLE);
    expect(segunda.request.body).toMatchObject({ version: 4 });
    segunda.flush({
      ...BORRADOR,
      concepto: 'Alquiler octubre corregido',
      comprobanteTipo: 'Factura C',
      comprobanteNumero: '1',
      version: 5,
    });
    await estabilizar(fixture);

    boton(fixture, 'Confirmar el egreso').click();
    httpMock
      .expectOne((p) => p.method === 'POST' && p.url === `${DETALLE}/confirmacion`)
      .flush(CONFIRMADO);
    httpMock.expectOne(DETALLE).flush(CONFIRMADO);
    httpMock.expectOne((p) => p.url === JORNADAS).flush([]);
    await estabilizar(fixture);

    expect(contenido(fixture)).toContain('Egreso confirmado');
    expect(contenido(fixture)).toContain('Registrar un pago');
  });

  it('con efectivo avisa que la caja esta cerrada y un rechazo caja-no-abierta lleva a la caja', async () => {
    const fixture = await montar(CONFIRMADO, []);
    expect(campo<HTMLInputElement>(fixture, '#pago-importe').value).toBe('300000.00');
    expect(contenido(fixture)).toContain('la caja de esta sede esta cerrada');

    enviar(fixture, 0);
    const pago = httpMock.expectOne((p) => p.method === 'POST' && p.url === `${DETALLE}/pagos`);
    expect(pago.request.body).toMatchObject({ importe: 300000, medio: 'EFECTIVO' });
    const clave = (pago.request.body as { idempotencyKey: string }).idempotencyKey;
    expect(clave).toBeTruthy();
    pago.flush(...problema('caja-no-abierta'));
    await estabilizar(fixture);

    expect(contenido(fixture)).toContain('la caja de esta sede no esta abierta');
    const enlace = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      '#titulo-rechazo ~ .acciones a',
    )!;
    expect(enlace.getAttribute('href')).toBe('/caja');

    // Un pago parcial por transferencia: otro contenido, otra clave, y no toca el cajon.
    elegir(fixture, '#pago-medio', 'TRANSFERENCIA');
    escribir(fixture, '#pago-importe', '100000');
    escribir(fixture, '#pago-referencia', 'TRF-123');
    expect(contenido(fixture)).toContain('no toca el cajon');
    enviar(fixture, 0);
    const parcial = httpMock.expectOne((p) => p.method === 'POST' && p.url === `${DETALLE}/pagos`);
    expect(parcial.request.body).toMatchObject({
      importe: 100000,
      medio: 'TRANSFERENCIA',
      referencia: 'TRF-123',
    });
    expect((parcial.request.body as { idempotencyKey: string }).idempotencyKey).not.toBe(clave);
    parcial.flush({ ...PAGO, medio: 'TRANSFERENCIA' });
    httpMock.expectOne(DETALLE).flush({ ...CONFIRMADO, saldoPendiente: 200000 });
    httpMock.expectOne((p) => p.url === JORNADAS).flush([]);
    await estabilizar(fixture);
    expect(contenido(fixture)).toContain('Pago registrado.');
  });

  it('con la caja abierta muestra cuanto hay en el cajon', async () => {
    const fixture = await montar(CONFIRMADO, [
      { id: 9, estado: 'ABIERTA', moneda: 'ARS', saldoTeorico: 12500 },
    ]);
    expect(contenido(fixture)).toContain('Caja abierta');
    expect(contenido(fixture)).toContain('12.500,00');
  });

  it('con pagos vigentes no ofrece anular el egreso, y anular un pago pide motivo', async () => {
    const pagado = { ...CONFIRMADO, estado: 'PAGADO', saldoPendiente: 0, pagos: [PAGO] };
    const fixture = await montar(pagado);
    expect(contenido(fixture)).toContain('Anula primero cada pago');
    expect(botonOpcional(fixture, 'Anular el egreso')).toBeUndefined();
    expect(contenido(fixture)).toContain('300.000,00');

    boton(fixture, 'Anular el pago').click();
    fixture.detectChanges();
    escribir(fixture, '#motivo-anular-pago-501', 'Se pago dos veces');
    const forms = (fixture.nativeElement as HTMLElement).querySelectorAll('form');
    forms[forms.length - 1].dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    const anulacion = httpMock.expectOne(
      (p) => p.method === 'POST' && p.url === `${DETALLE}/pagos/501/anulacion`,
    );
    expect(anulacion.request.body).toEqual({ motivo: 'Se pago dos veces' });
    anulacion.flush({ ...PAGO, estado: 'ANULADO' });
    httpMock.expectOne(DETALLE).flush({
      ...CONFIRMADO,
      saldoPendiente: 100000,
      pagos: [{ ...PAGO, estado: 'ANULADO', motivoAnulacion: 'Se pago dos veces' }],
    });
    httpMock.expectOne((p) => p.url === JORNADAS).flush([]);
    await estabilizar(fixture);

    expect(contenido(fixture)).toContain('Pago anulado');
    expect(boton(fixture, 'Anular el egreso')).toBeDefined();
  });

  it('anular el egreso manda el motivo', async () => {
    const fixture = await montar(BORRADOR);
    boton(fixture, 'Anular el egreso').click();
    fixture.detectChanges();
    escribir(fixture, '#motivo-anular-egreso', 'Cargado por error');
    const forms = (fixture.nativeElement as HTMLElement).querySelectorAll('form');
    forms[forms.length - 1].dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    httpMock
      .expectOne((p) => p.method === 'POST' && p.url === `${DETALLE}/anulacion`)
      .flush({ ...BORRADOR, estado: 'ANULADO' });
    httpMock.expectOne(DETALLE).flush({
      ...BORRADOR,
      estado: 'ANULADO',
      anuladoEn: '2026-10-11T15:00:00Z',
      motivoAnulacion: 'Cargado por error',
    });
    await estabilizar(fixture);

    expect(contenido(fixture)).toContain('Egreso anulado');
    expect(contenido(fixture)).toContain('Cargado por error');
  });

  it('una correccion con versión vieja avisa sin pisar nada y ofrece recargar', async () => {
    const fixture = await montar(BORRADOR);
    escribir(fixture, '#edicion-concepto', 'Alquiler octubre corregido');
    enviar(fixture, 0);

    httpMock
      .expectOne((p) => p.method === 'PUT' && p.url === DETALLE)
      .flush(...problema('concurrent-modification'));
    await estabilizar(fixture);
    expect(contenido(fixture)).toContain('Alguien cambio este egreso después de que lo abriste');

    boton(fixture, 'Recargar el egreso').click();
    httpMock.expectOne(DETALLE).flush({ ...BORRADOR, concepto: 'Lo que guardo otro', version: 4 });
    await estabilizar(fixture);
    expect(campo<HTMLInputElement>(fixture, '#edicion-concepto').value).toBe('Lo que guardo otro');

    enviar(fixture, 0);
    const reintento = httpMock.expectOne((p) => p.method === 'PUT' && p.url === DETALLE);
    expect(reintento.request.body).toMatchObject({ version: 4 });
    reintento.flush({ ...BORRADOR, concepto: 'Lo que guardo otro', version: 5 });
    await estabilizar(fixture);
  });

  it('la correccion manda siempre la oferta actual, porque el PUT reemplaza (DP-39)', async () => {
    const fixture = await montar({ ...BORRADOR, ofertaId: 33 });
    // Imputado a una oferta de baja: se nombra y se sigue ofreciendo para no perderla.
    expect(contenido(fixture)).toContain('Funcional (dada de baja)');
    expect(campo<HTMLSelectElement>(fixture, '#edicion-oferta').value).toBe('33');

    escribir(fixture, '#edicion-concepto', 'Alquiler del salon de Funcional');
    enviar(fixture, 0);
    const edicion = httpMock.expectOne((p) => p.method === 'PUT' && p.url === DETALLE);
    expect(edicion.request.body).toMatchObject({
      ofertaId: 33,
      concepto: 'Alquiler del salon de Funcional',
    });
    edicion.flush({ ...BORRADOR, ofertaId: 33, version: 4 });
    await estabilizar(fixture);

    elegir(fixture, '#edicion-oferta', '');
    enviar(fixture, 0);
    const sinImputar = httpMock.expectOne((p) => p.method === 'PUT' && p.url === DETALLE);
    expect((sinImputar.request.body as Record<string, unknown>)['ofertaId']).toBeUndefined();
    sinImputar.flush({ ...BORRADOR, version: 5 });
    await estabilizar(fixture);
    expect(contenido(fixture)).toContain('Sin imputar a un servicio');
  });

  it('un egreso de liquidación enlaza la liquidación y solo deja corregir concepto y comprobante', async () => {
    const fixture = await montar({
      ...BORRADOR,
      tipoBeneficiario: 'COLABORADOR',
      categoria: 'HONORARIOS_PROFESIONALES',
      importeTotal: 500,
      periodoDesde: '2026-10-01',
      periodoHasta: '2026-10-31',
      ofertaId: 31,
      liquidacionHonorariosId: 77,
    });
    expect(contenido(fixture)).toContain('Pilates grupal');
    expect(contenido(fixture)).toContain('Nacio de una liquidación de honorarios por clase');
    const enlace = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      'a[href="/egresos/honorarios/liquidaciones/77"]',
    );
    expect(enlace).not.toBeNull();
    expect(campo<HTMLInputElement>(fixture, '#edicion-importe').disabled).toBe(true);
    expect(campo<HTMLSelectElement>(fixture, '#edicion-oferta').disabled).toBe(true);
    expect(campo<HTMLSelectElement>(fixture, '#edicion-categoria').disabled).toBe(true);
    expect(campo<HTMLInputElement>(fixture, '#edicion-concepto').disabled).toBe(false);

    escribir(fixture, '#edicion-comprobante-tipo', 'Factura C');
    escribir(fixture, '#edicion-comprobante-numero', '0001-1');
    enviar(fixture, 0);
    const edicion = httpMock.expectOne((p) => p.method === 'PUT' && p.url === DETALLE);
    // Lo bloqueado viaja con su valor leido: el PUT reemplaza todo.
    expect(edicion.request.body).toMatchObject({
      categoria: 'HONORARIOS_PROFESIONALES',
      importeTotal: 500,
      periodoDesde: '2026-10-01',
      periodoHasta: '2026-10-31',
      ofertaId: 31,
      comprobanteTipo: 'Factura C',
    });
    edicion.flush(...problema('egreso-de-liquidacion'));
    await estabilizar(fixture);
    expect(contenido(fixture)).toContain('Este egreso nacio de una liquidación de honorarios');
  });

  it('un egreso que no existe muestra el error de carga', async () => {
    const fixture = crear();
    httpMock.expectOne(DETALLE).flush(...problema('not-found', 404));
    await estabilizar(fixture);
    expect(contenido(fixture)).toContain('No se pudo cargar el egreso');
  });

  it(
    'no tiene violaciones de accesibilidad con un pago listado y el formulario de pago',
    async () => {
      const fixture = await montar({ ...CONFIRMADO, saldoPendiente: 200000, pagos: [PAGO] }, []);
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // ------------------------------------------------------------------------------------

  function crear(): ComponentFixture<EgresoDetallePage> {
    const fixture = TestBed.createComponent(EgresoDetallePage);
    fixture.componentRef.setInput('egresoId', String(EGRESO_ID));
    fixture.detectChanges();
    httpMock.expectOne((p) => p.url === `${BASE}/ofertas`).flush(OFERTAS);
    return fixture;
  }

  async function montar(
    egreso: object,
    jornadas?: object[],
  ): Promise<ComponentFixture<EgresoDetallePage>> {
    const fixture = crear();
    httpMock.expectOne(DETALLE).flush(egreso);
    if (jornadas !== undefined) {
      const caja = httpMock.expectOne((p) => p.url === JORNADAS);
      expect(caja.request.params.get('estado')).toBe('ABIERTA');
      caja.flush(jornadas);
    }
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<EgresoDetallePage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function contenido(fixture: ComponentFixture<EgresoDetallePage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function campo<T extends HTMLElement>(
    fixture: ComponentFixture<EgresoDetallePage>,
    selector: string,
  ) {
    return (fixture.nativeElement as HTMLElement).querySelector<T>(selector)!;
  }

  function botonOpcional(
    fixture: ComponentFixture<EgresoDetallePage>,
    texto: string,
  ): HTMLButtonElement | undefined {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent?.trim().startsWith(texto));
  }

  function boton(fixture: ComponentFixture<EgresoDetallePage>, texto: string): HTMLButtonElement {
    const encontrado = botonOpcional(fixture, texto);
    expect(encontrado, `botón "${texto}"`).toBeDefined();
    return encontrado!;
  }

  function elegir(fixture: ComponentFixture<EgresoDetallePage>, selector: string, valor: string) {
    const select = campo<HTMLSelectElement>(fixture, selector);
    select.value = valor;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribir(fixture: ComponentFixture<EgresoDetallePage>, selector: string, valor: string) {
    const input = campo<HTMLInputElement>(fixture, selector);
    input.value = valor;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function enviar(fixture: ComponentFixture<EgresoDetallePage>, indice: number) {
    const forms = (fixture.nativeElement as HTMLElement).querySelectorAll('form');
    forms[indice].dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }
});
