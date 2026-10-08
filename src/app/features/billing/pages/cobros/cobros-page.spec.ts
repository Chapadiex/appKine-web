import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CobrosPage } from './cobros-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';
import { PERMISO_CAJA_OPERATE, PERMISO_COBRO_REGISTER } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';

const CONSULTORIO = 3;
const PERSONA = 128;
const COBRO_ID = 5001;

const LISTADO = `/api/v1/consultorios/${CONSULTORIO}/cobros?personaId=${PERSONA}`;
const DETALLE = `/api/v1/consultorios/${CONSULTORIO}/cobros/${COBRO_ID}`;
const ANULAR = `${DETALLE}/anulacion`;
const REINTEGRAR = `${DETALLE}/reintegros`;
const AMBOS_PERMISOS = [PERMISO_COBRO_REGISTER, PERMISO_CAJA_OPERATE];

const COBRO = {
  id: COBRO_ID,
  comprobanteNumero: 142,
  consultorioId: CONSULTORIO,
  personaId: PERSONA,
  moneda: 'ARS',
  total: 8500.5,
  cobradoEn: '2026-09-15T13:02:00Z',
  medios: [
    { medio: 'EFECTIVO', importe: 8000 },
    { medio: 'TARJETA_DEBITO', importe: 500.5, referencia: 'op-99182' },
  ],
  imputaciones: [{ obligacionId: 9001, importe: 8500.5 }],
  saldoAFavor: 0,
  estado: 'VIGENTE',
  version: 0,
};

/** Cobro de 10.000 que imputo 6.000 y dejo 4.000 a favor (F-3). */
const CON_SALDO = {
  ...COBRO,
  total: 10000,
  medios: [{ medio: 'EFECTIVO', importe: 10000 }],
  imputaciones: [{ obligacionId: 9001, importe: 6000 }],
  saldoAFavor: 4000,
};

/**
 * Spec del listado de cobros y la reimpresion (M19, AKINE-07.02).
 *
 * <p>Cubre lo que decide comportamiento: que el comprobante se <b>relea</b> del servidor en vez de
 * reimprimir lo que hay en memoria, que aca tampoco se sume plata, y que un fallo al abrirlo no
 * voltee el listado.
 */
describe('CobrosPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CobrosPage],
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

  it('lista los cobros con su comprobante y sin inventar un total', async () => {
    const fixture = await montar([COBRO]);

    const contenido = texto(fixture);
    expect(contenido).toContain('142');
    expect(contenido).toContain('8.500,50');
    expect(contenido).toContain('No se muestra un total de lo cobrado');
  });

  it('abrir el comprobante lo RELEE del servidor: no reimprime lo que hay en memoria', async () => {
    const fixture = await montar([COBRO]);

    apretar(fixture, 'Ver el comprobante');
    const pedido = httpMock.expectOne(DETALLE);
    expect(pedido.request.method).toBe('GET');

    // El servidor devuelve el comprobante fresco. Si la pantalla usara la fila del listado, el
    // numero viejo seguiria en pantalla.
    pedido.flush({ ...COBRO, comprobanteNumero: 143 });
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('Comprobante N.º 143');
    expect(contenido).toContain('Efectivo');
    expect(contenido).toContain('Tarjeta de debito');
    expect(contenido).toContain('op-99182');
    expect(contenido).toContain('Deuda #9001');
  });

  it('si el comprobante no se puede abrir, el listado sigue en pie', async () => {
    const fixture = await montar([COBRO]);

    apretar(fixture, 'Ver el comprobante');
    httpMock
      .expectOne(DETALLE)
      .flush(
        { type: 'https://akine.app/problems/not-found', status: 404, detail: 'No existe.' },
        { status: 404, statusText: 'Not Found' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No se pudo abrir el comprobante');
    // El listado no se voltea: perder los cobros porque uno no abrio seria peor.
    expect(texto(fixture)).toContain('142');
  });

  it('sin cobros ofrece el camino para registrar el primero', async () => {
    const fixture = await montar([]);

    expect(texto(fixture)).toContain('no tiene ningun cobro registrado');
  });

  it('sin sede en el contexto no pide nada y manda al selector', async () => {
    const fixture = TestBed.createComponent(CobrosPage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();
    await estabilizar(fixture);

    httpMock.expectNone(esListado());
    expect(texto(fixture)).toContain('Eligi una organizacion');
  });

  // -------------------------------------------------------------------------------------
  // F-3: anulacion y reintegro
  // -------------------------------------------------------------------------------------

  it('anular manda el motivo, relee y avisa que no se borra nada', async () => {
    const fixture = await montar([COBRO]);

    apretar(fixture, 'Anular');
    escribirEn(fixture, '#anular-cobro-' + COBRO_ID, 'Se cobro al paciente equivocado.');
    apretar(fixture, 'Anular el cobro');

    const pedido = httpMock.expectOne((p) => p.method === 'POST' && p.url === ANULAR);
    expect(pedido.request.body).toEqual({ motivo: 'Se cobro al paciente equivocado.' });
    pedido.flush({
      ...COBRO,
      estado: 'ANULADO',
      motivoAnulacion: 'Se cobro al paciente equivocado.',
    });
    await estabilizar(fixture);

    // Relee: un cobro anulado deja de aparecer en el listado por persona.
    responder(httpMock.expectOne(esListado()), []);
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Se anulo el comprobante N.º 142');
    expect(texto(fixture)).toContain('no se borra nada');
  });

  it('un cobro con reintegros no se puede anular, y lo dice', async () => {
    // 10.000 = 6.000 imputados + 1.000 a favor + 3.000 ya devueltos.
    const fixture = await montar([{ ...CON_SALDO, saldoAFavor: 1000 }]);

    expect(boton(fixture, 'Anular')?.disabled).toBe(true);
    expect(texto(fixture)).toContain('ya devolvio parte de su saldo a favor');
    // Lo que queda a favor si se puede devolver.
    expect(boton(fixture, 'Reintegrar saldo a favor')?.disabled).toBe(false);
  });

  it('sin caja:operate no ofrece anular ni reintegrar', async () => {
    const fixture = await montar([CON_SALDO], [PERMISO_COBRO_REGISTER]);

    expect(boton(fixture, 'Anular')).toBeNull();
    expect(boton(fixture, 'Reintegrar saldo a favor')).toBeNull();
  });

  it('no manda un reintegro mayor que el saldo a favor', async () => {
    const fixture = await montar([CON_SALDO]);

    apretar(fixture, 'Reintegrar saldo a favor');
    escribirEn(fixture, '#reintegro-importe-' + COBRO_ID, '4000,01');
    escribirEn(fixture, '#reintegro-motivo-' + COBRO_ID, 'Devolucion del sobrante.');
    apretar(fixture, 'Reintegrar');

    httpMock.expectNone((p) => p.method === 'POST' && p.url === REINTEGRAR);
    expect(texto(fixture)).toContain('No puede superar el saldo a favor');
  });

  it('reintegra con medio y clave, y traduce caja-no-abierta', async () => {
    const fixture = await montar([CON_SALDO]);

    apretar(fixture, 'Reintegrar saldo a favor');
    // El efectivo sale del cajon, y la pantalla lo avisa antes de confirmar.
    expect(texto(fixture)).toContain('El efectivo sale del cajon');
    escribirEn(fixture, '#reintegro-importe-' + COBRO_ID, '1500');
    escribirEn(fixture, '#reintegro-motivo-' + COBRO_ID, 'Devolucion del sobrante.');
    apretar(fixture, 'Reintegrar');

    const pedido = httpMock.expectOne((p) => p.method === 'POST' && p.url === REINTEGRAR);
    const cuerpo = pedido.request.body as Record<string, unknown>;
    expect(cuerpo['importe']).toBe(1500);
    expect(cuerpo['medio']).toBe('EFECTIVO');
    expect(cuerpo['motivo']).toBe('Devolucion del sobrante.');
    expect(typeof cuerpo['idempotencyKey']).toBe('string');
    rechazar(pedido, 'caja-no-abierta');
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('La caja de esta sede no esta abierta');
  });

  it(
    'no tiene violaciones de accesibilidad con el reintegro abierto',
    async () => {
      const fixture = await montar([CON_SALDO]);
      apretar(fixture, 'Reintegrar saldo a favor');
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  it(
    'no tiene violaciones de accesibilidad con el comprobante abierto',
    async () => {
      const fixture = await montar([COBRO]);
      apretar(fixture, 'Ver el comprobante');
      httpMock.expectOne(DETALLE).flush(COBRO);
      await estabilizar(fixture);

      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  async function montar(
    cobros: object[],
    otorgados: readonly string[] = AMBOS_PERMISOS,
  ): Promise<ComponentFixture<CobrosPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });

    // Se siembran los permisos antes de montar para que la directiva no los pida por su cuenta.
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: otorgados });

    const fixture = TestBed.createComponent(CobrosPage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();

    responder(httpMock.expectOne(esListado()), cobros);
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<CobrosPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function responder(pedido: TestRequest, cobros: object[]): void {
    pedido.flush(cobros);
  }

  function apretar(fixture: ComponentFixture<CobrosPage>, rotulo: string): void {
    const boton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim() === rotulo);
    if (boton === undefined) {
      throw new Error(`No hay ningun boton rotulado "${rotulo}".`);
    }
    boton.click();
    fixture.detectChanges();
  }

  function boton(fixture: ComponentFixture<CobrosPage>, rotulo: string): HTMLButtonElement | null {
    return (
      Array.from(
        fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
      ).find((b) => (b.textContent ?? '').trim() === rotulo) ?? null
    );
  }

  function escribirEn(
    fixture: ComponentFixture<CobrosPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function rechazar(pedido: TestRequest, tipo: string): void {
    pedido.flush(
      { type: 'https://akine.app/problems/' + tipo, status: 409, detail: 'Rechazado.' },
      { status: 409, statusText: 'Conflict' },
    );
  }

  function texto(fixture: ComponentFixture<CobrosPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function esListado() {
    return (p: HttpRequest<unknown>) => p.method === 'GET' && p.urlWithParams === LISTADO;
  }
});
