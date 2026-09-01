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

const CONSULTORIO = 3;
const PERSONA = 128;
const COBRO_ID = 5001;

const LISTADO = `/api/v1/consultorios/${CONSULTORIO}/cobros?personaId=${PERSONA}`;
const DETALLE = `/api/v1/consultorios/${CONSULTORIO}/cobros/${COBRO_ID}`;

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
  version: 0,
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

  async function montar(cobros: object[]): Promise<ComponentFixture<CobrosPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });

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

  function texto(fixture: ComponentFixture<CobrosPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function esListado() {
    return (p: HttpRequest<unknown>) => p.method === 'GET' && p.urlWithParams === LISTADO;
  }
});
