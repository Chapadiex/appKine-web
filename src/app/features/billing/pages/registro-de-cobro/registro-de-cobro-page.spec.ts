import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { RegistroDeCobroPage } from './registro-de-cobro-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const PERSONA = 128;

const OBLIGACIONES = `/api/v1/consultorios/${CONSULTORIO}/obligaciones?personaId=${PERSONA}`;
const FICHA = `/api/v1/personas/${PERSONA}`;
const COBROS = `/api/v1/consultorios/${CONSULTORIO}/cobros`;

const DEUDA = {
  id: 9001,
  personaId: PERSONA,
  consultorioId: CONSULTORIO,
  estado: 'PENDIENTE',
  responsable: 'PACIENTE',
  moneda: 'ARS',
  importeOriginal: 8500.5,
  saldo: 8500.5,
  snapshotPrecio: 8500.5,
  snapshotNombre: 'Kinesiologia - sesion',
  devengadaEn: '2026-09-15T12:48:00Z',
  version: 0,
};

/** Dos deudas de 0,10 y 0,20: su suma es la que el punto flotante no sabe hacer. */
const CENTAVO_A = { ...DEUDA, id: 9101, importeOriginal: 0.1, saldo: 0.1 };
const CENTAVO_B = { ...DEUDA, id: 9102, importeOriginal: 0.2, saldo: 0.2 };

const PAGADA = { ...DEUDA, id: 9002, estado: 'PAGADA', saldo: 0 };
const ANULADA = { ...DEUDA, id: 9003, estado: 'ANULADA', saldo: 8500.5 };

interface CuerpoDeCobro {
  readonly total: number;
  readonly personaId: number;
  readonly idempotencyKey: string;
  readonly medios: readonly { readonly medio: string; readonly importe: number }[];
  readonly imputaciones: readonly { readonly obligacionId: number; readonly importe: number }[];
}

/**
 * Spec del registro de cobro (M19, AKINE-07.02).
 *
 * <p>Cubre <b>las tres reglas de negocio que esta pantalla no puede violar</b>, y nada del
 * andamiaje:
 *
 * <ol>
 *   <li><b>Los importes son decimales exactos.</b> La suma de los medios se compara contra la de
 *       las imputaciones en centavos enteros. Con flotantes, un cobro de $0,30 pagado con $0,10 y
 *       $0,20 quedaria bloqueado por una diferencia que no existe.</li>
 *   <li><b>El saldo no puede quedar negativo.</b> Antes, la pantalla no deja imputar mas que el
 *       saldo. Despues, el 409 `saldo-insuficiente` del backend se muestra como la garantia
 *       funcionando y con la salida correcta, que es recargar.</li>
 *   <li><b>La clave de idempotencia es una por composicion.</b> Estable mientras nada cambia
 *       —para que un reintento no cobre dos veces— y descartada ante cualquier edicion, porque
 *       reusarla con otro contenido es 409 y no el cobro anterior.</li>
 * </ol>
 */
describe('RegistroDeCobroPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RegistroDeCobroPage],
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

  // -------------------------------------------------------------------------------------
  // 1. Decimal exacto
  // -------------------------------------------------------------------------------------

  it('acepta el cobro que el punto flotante rechazaria: 0,10 + 0,20 son exactamente 0,30', async () => {
    const fixture = await montar([CENTAVO_A, CENTAVO_B]);

    elegir(fixture, CENTAVO_A.id);
    elegir(fixture, CENTAVO_B.id);
    // Dos medios que suman lo mismo que las dos imputaciones. `0.1 + 0.2 !== 0.3` en binario: si
    // la pantalla sumara con `number`, esto quedaria bloqueado sin ninguna razon visible.
    escribirEn(fixture, '#importe-medio-0', '0,10');
    apretar(fixture, 'Agregar otro medio de pago');
    escribirEn(fixture, '#importe-medio-1', '0,20');

    expect(texto(fixture)).not.toContain('Tienen que dar lo mismo');
    apretar(fixture, 'Registrar el cobro');

    const pedido = httpMock.expectOne(esRegistro());
    const cuerpo = cuerpoDe(pedido);
    expect(cuerpo.total).toBe(0.3);
    expect(cuerpo.medios.map((m) => m.importe)).toEqual([0.1, 0.2]);
    expect(cuerpo.imputaciones.map((i) => i.importe)).toEqual([0.1, 0.2]);
    responderCobro(pedido);
  });

  it('bloquea el cobro cuando los medios no dan el total, y dice cuanto falta', async () => {
    const fixture = await montar([DEUDA]);

    elegir(fixture, DEUDA.id);
    // Un cero de menos: 850,00 contra 8.500,50. Es el error que el servidor rechaza con 400 y que
    // la pantalla tiene que atajar antes, con el paciente enfrente.
    escribirEn(fixture, '#importe-medio-0', '850');

    expect(texto(fixture)).toContain('Tienen que dar lo mismo');
    expect(botonDe(fixture, 'Registrar el cobro').disabled).toBe(true);

    apretar(fixture, 'Registrar el cobro');
    httpMock.expectNone(esRegistro());
  });

  it('completar con el total copia el importe exacto, sin que nadie lo tipee', async () => {
    const fixture = await montar([DEUDA]);

    elegir(fixture, DEUDA.id);
    apretar(fixture, 'Completar con el total imputado');
    apretar(fixture, 'Registrar el cobro');

    const pedido = httpMock.expectOne(esRegistro());
    expect(cuerpoDe(pedido).total).toBe(8500.5);
    responderCobro(pedido);
  });

  // -------------------------------------------------------------------------------------
  // 2. El saldo no queda negativo
  // -------------------------------------------------------------------------------------

  it('no deja imputar mas que el saldo leido', async () => {
    const fixture = await montar([DEUDA]);

    elegir(fixture, DEUDA.id);
    escribirEn(fixture, `#imputacion-${DEUDA.id}`, '9000');
    escribirEn(fixture, '#importe-medio-0', '9000');

    expect(texto(fixture)).toContain('Un saldo no puede quedar negativo');
    expect(botonDe(fixture, 'Registrar el cobro').disabled).toBe(true);
  });

  it('el 409 saldo-insuficiente se muestra como la garantia funcionando y ofrece recargar', async () => {
    const fixture = await montar([DEUDA]);

    elegir(fixture, DEUDA.id);
    apretar(fixture, 'Completar con el total imputado');
    apretar(fixture, 'Registrar el cobro');

    rechazar(httpMock.expectOne(esRegistro()), 'saldo-insuficiente', {
      obligacionId: DEUDA.id,
      importeIntentado: 8500.5,
    });
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('alguien cobro antes');
    expect(contenido).toContain('ningun saldo quedo en negativo');
    expect(rotulosDeBoton(fixture)).toContain('Recargar los saldos y volver a armar el cobro');

    // Recargar relee de verdad y descarta la seleccion: los saldos que la justificaban cambiaron.
    apretar(fixture, 'Recargar los saldos y volver a armar el cobro');
    httpMock.expectOne(FICHA).flush({ id: PERSONA, apellido: 'Gomez', nombre: 'Ana' });
    httpMock.expectOne(esListado()).flush([{ ...DEUDA, saldo: 100 }]);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Eligi al menos una deuda');
  });

  it('el 409 caja-no-abierta ofrece ir a la caja y deja el cobro armado para reintentar', async () => {
    const fixture = await montar([DEUDA]);

    elegir(fixture, DEUDA.id);
    apretar(fixture, 'Completar con el total imputado');
    apretar(fixture, 'Registrar el cobro');

    rechazar(httpMock.expectOne(esRegistro()), 'caja-no-abierta', { consultorioId: 7 });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No hay una caja abierta en esta sede');
    const enlace = Array.from(
      fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>,
    ).find((a) => (a.textContent ?? '').trim() === 'Ir a la caja');
    expect(enlace?.getAttribute('href')).toBe('/caja');
    // Recargar la cuenta no abre ninguna caja: ofrecerlo mandaria a repetir el mismo rechazo.
    expect(rotulosDeBoton(fixture)).not.toContain('Recargar los saldos y volver a armar el cobro');
    expect(botonDe(fixture, 'Registrar el cobro').disabled).toBe(false);
  });

  it('las deudas pagadas y anuladas no se ofrecen: imputar contra ellas no descuenta nada', async () => {
    const fixture = await montar([DEUDA, PAGADA, ANULADA]);

    expect(fixture.nativeElement.querySelector(`#deuda-${DEUDA.id}`)).not.toBeNull();
    expect(fixture.nativeElement.querySelector(`#deuda-${PAGADA.id}`)).toBeNull();
    expect(fixture.nativeElement.querySelector(`#deuda-${ANULADA.id}`)).toBeNull();
  });

  // -------------------------------------------------------------------------------------
  // 3. La clave de idempotencia
  // -------------------------------------------------------------------------------------

  it('la clave es estable mientras nada cambia y se descarta ante cualquier edicion', async () => {
    const fixture = await montar([DEUDA]);

    elegir(fixture, DEUDA.id);
    apretar(fixture, 'Completar con el total imputado');
    apretar(fixture, 'Registrar el cobro');

    const primerIntento = httpMock.expectOne(esRegistro());
    const clave = cuerpoDe(primerIntento).idempotencyKey;
    expect(clave).not.toBe('');

    // Mismo contenido: la clave se conserva, que es lo que hace que un reintento no cobre dos
    // veces. El backend devuelve el mismo cobro con el mismo comprobante.
    rechazar(primerIntento, 'conflict');
    await estabilizar(fixture);
    apretar(fixture, 'Registrar el cobro');
    const reintento = httpMock.expectOne(esRegistro());
    expect(cuerpoDe(reintento).idempotencyKey).toBe(clave);

    // Otro contenido: la clave anterior identificaba un pedido distinto, y reusarla es el 409
    // `idempotency-key-conflict`.
    rechazar(reintento, 'conflict');
    await estabilizar(fixture);
    escribirEn(fixture, '#importe-medio-0', '8500,50');
    escribirEn(fixture, `#imputacion-${DEUDA.id}`, '8500,50');
    apretar(fixture, 'Registrar el cobro');

    const tercero = httpMock.expectOne(esRegistro());
    expect(cuerpoDe(tercero).idempotencyKey).not.toBe(clave);
    responderCobro(tercero);
  });

  it('el 409 de clave reusada quema la clave y ofrece reintentar', async () => {
    const fixture = await montar([DEUDA]);

    elegir(fixture, DEUDA.id);
    apretar(fixture, 'Completar con el total imputado');
    apretar(fixture, 'Registrar el cobro');

    const primero = httpMock.expectOne(esRegistro());
    const clave = cuerpoDe(primero).idempotencyKey;
    rechazar(primero, 'idempotency-key-conflict');
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No es un error tuyo');
    apretar(fixture, 'Volver a intentar el cobro');

    const segundo = httpMock.expectOne(esRegistro());
    expect(cuerpoDe(segundo).idempotencyKey).not.toBe(clave);
    responderCobro(segundo);
  });

  // -------------------------------------------------------------------------------------
  // 4. Resultado
  // -------------------------------------------------------------------------------------

  it('muestra el comprobante y deja de ofrecer el formulario', async () => {
    const fixture = await montar([DEUDA]);

    elegir(fixture, DEUDA.id);
    apretar(fixture, 'Completar con el total imputado');
    apretar(fixture, 'Registrar el cobro');
    responderCobro(httpMock.expectOne(esRegistro()));
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('142');
    expect(contenido).toContain('correlativo por sede');
    // No se puede volver a apretar "Registrar el cobro" sobre un cobro ya hecho.
    expect(rotulosDeBoton(fixture)).not.toContain('Registrar el cobro');
  });

  it('sin sede en el contexto no arma ninguna URL y manda al selector', async () => {
    const fixture = TestBed.createComponent(RegistroDeCobroPage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();
    await estabilizar(fixture);

    httpMock.expectNone(esListado());
    expect(texto(fixture)).toContain('Eligi una organizacion');
  });

  it('sin deuda cobrable no dibuja un formulario vacio', async () => {
    const fixture = await montar([PAGADA]);

    expect(texto(fixture)).toContain('no tiene ninguna deuda con saldo pendiente');
    expect(rotulosDeBoton(fixture)).not.toContain('Registrar el cobro');
  });

  // -------------------------------------------------------------------------------------
  // Accesibilidad
  // -------------------------------------------------------------------------------------

  it(
    'no tiene violaciones de accesibilidad con el formulario cargado',
    async () => {
      const fixture = await montar([DEUDA]);
      elegir(fixture, DEUDA.id);
      apretar(fixture, 'Completar con el total imputado');
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // E-6. Modo prepago: anticipo puro atado al turno
  // -------------------------------------------------------------------------------------

  describe('modo prepago (E-6)', () => {
    it('manda un anticipo puro con el turno, sin leer la cuenta corriente', async () => {
      const fixture = await montarPrepago();

      expect(texto(fixture)).toContain('Registrar un prepago');
      // El importe sugerido llega precargado y es editable.
      const importe = fixture.nativeElement.querySelector('#importe-medio-0') as HTMLInputElement;
      expect(importe.value).toBe('15000.00');

      apretar(fixture, 'Registrar el prepago');

      const pedido = httpMock.expectOne(esRegistro());
      expect(pedido.request.body).toEqual(
        expect.objectContaining({
          personaId: PERSONA,
          turnoId: 77,
          total: 15000,
          anticipo: 15000,
          imputaciones: [],
          moneda: 'ARS',
        }),
      );
      responderCobro(pedido);
      await estabilizar(fixture);

      expect(texto(fixture)).toContain('Se imputa solo al cerrar la sesion');
      expect(texto(fixture)).toContain('Volver a la recepcion del dia');
    });

    it('no deja confirmar sin una moneda valida', async () => {
      const fixture = await montarPrepago();
      escribirEn(fixture, '#moneda-prepago', 'pe');
      expect(botonDe(fixture, 'Registrar el prepago').disabled).toBe(true);
      expect(texto(fixture)).toContain('codigo de tres letras');
    });

    it('traduce prepago-ya-registrado y prepago-no-admitido y ofrece volver a la recepcion', async () => {
      const fixture = await montarPrepago();

      apretar(fixture, 'Registrar el prepago');
      rechazar(httpMock.expectOne(esRegistro()), 'prepago-ya-registrado', { cobroId: 5001 });
      await estabilizar(fixture);
      expect(texto(fixture)).toContain('ya tiene un prepago registrado');
      expect(texto(fixture)).toContain('Ver los cobros del paciente');

      apretar(fixture, 'Registrar el prepago');
      rechazar(httpMock.expectOne(esRegistro()), 'prepago-no-admitido');
      await estabilizar(fixture);
      expect(texto(fixture)).toContain('ya no admite un prepago');
      expect(texto(fixture)).toContain('Volver a la recepcion del dia');
    });

    async function montarPrepago(): Promise<ComponentFixture<RegistroDeCobroPage>> {
      tenantContext.select({
        organizationId: 1,
        organizationName: 'Centro Belgrano',
        consultorioId: CONSULTORIO,
        consultorioName: 'Sede Centro',
      });
      const fixture = TestBed.createComponent(RegistroDeCobroPage);
      fixture.componentRef.setInput('personaId', String(PERSONA));
      fixture.componentRef.setInput('turnoId', '77');
      fixture.componentRef.setInput('importeSugerido', '15000');
      fixture.componentRef.setInput('monedaSugerida', 'ars');
      fixture.componentRef.setInput('fecha', '2026-10-07');
      fixture.detectChanges();

      httpMock.expectOne(FICHA).flush({ id: PERSONA, apellido: 'Gomez', nombre: 'Ana' });
      // Sin pedido a la cuenta corriente: `httpMock.verify()` lo hace cumplir.
      await estabilizar(fixture);
      return fixture;
    }
  });

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  async function montar(deudas: object[]): Promise<ComponentFixture<RegistroDeCobroPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });

    const fixture = TestBed.createComponent(RegistroDeCobroPage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();

    httpMock.expectOne(FICHA).flush({ id: PERSONA, apellido: 'Gomez', nombre: 'Ana' });
    httpMock.expectOne(esListado()).flush(deudas);
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<RegistroDeCobroPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function elegir(fixture: ComponentFixture<RegistroDeCobroPage>, obligacionId: number): void {
    const casilla = fixture.nativeElement.querySelector(
      `#deuda-${obligacionId}`,
    ) as HTMLInputElement;
    casilla.click();
    fixture.detectChanges();
  }

  function cuerpoDe(pedido: TestRequest): CuerpoDeCobro {
    return pedido.request.body as CuerpoDeCobro;
  }

  function responderCobro(pedido: TestRequest): void {
    pedido.flush(
      {
        id: 5001,
        comprobanteNumero: 142,
        consultorioId: CONSULTORIO,
        personaId: PERSONA,
        moneda: 'ARS',
        total: 8500.5,
        cobradoEn: '2026-09-15T13:02:00Z',
        medios: [{ medio: 'EFECTIVO', importe: 8500.5 }],
        imputaciones: [{ obligacionId: DEUDA.id, importe: 8500.5 }],
        version: 0,
      },
      { status: 201, statusText: 'Created' },
    );
  }

  function rechazar(
    pedido: TestRequest,
    tipo: string,
    extension: Record<string, unknown> = {},
  ): void {
    pedido.flush(
      {
        type: `https://akine.app/problems/${tipo}`,
        status: 409,
        detail: 'Rechazado.',
        ...extension,
      },
      { status: 409, statusText: 'Conflict' },
    );
  }

  function escribirEn(
    fixture: ComponentFixture<RegistroDeCobroPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function botonDe(
    fixture: ComponentFixture<RegistroDeCobroPage>,
    rotulo: string,
  ): HTMLButtonElement {
    const boton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim() === rotulo);
    if (boton === undefined) {
      throw new Error(`No hay ningun boton rotulado "${rotulo}".`);
    }
    return boton;
  }

  function apretar(fixture: ComponentFixture<RegistroDeCobroPage>, rotulo: string): void {
    botonDe(fixture, rotulo).click();
    fixture.detectChanges();
  }

  function rotulosDeBoton(fixture: ComponentFixture<RegistroDeCobroPage>): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).map((boton) => (boton.textContent ?? '').trim());
  }

  function texto(fixture: ComponentFixture<RegistroDeCobroPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function esListado() {
    return (p: HttpRequest<unknown>) => p.method === 'GET' && p.urlWithParams === OBLIGACIONES;
  }

  function esRegistro() {
    return (p: HttpRequest<unknown>) => p.method === 'POST' && p.url === COBROS;
  }
});
