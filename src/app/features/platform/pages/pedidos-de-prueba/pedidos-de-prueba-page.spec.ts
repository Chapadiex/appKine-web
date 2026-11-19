import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PedidosDePruebaPage } from './pedidos-de-prueba-page';
import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { AvisosStore } from '../../../../core/services/avisos.store';

const LISTADO = '/api/v1/platform/solicitudes-de-prueba';

const pedido = (id: number, estado = 'PENDIENTE', version = 0) => ({
  id,
  nombre: 'Ana',
  apellido: 'Prueba',
  email: `duenia${id}@centro.test`,
  telefono: '3515550000',
  ciudad: 'Córdoba',
  nombreCentro: `Centro Sintético ${id}`,
  kinesiologia: true,
  actividades: id === 2,
  interesaIa: id === 2,
  sedes: 'HASTA_TRES',
  comentario: 'Comentario sintético',
  estado,
  recibidaEn: '2026-11-18T15:00:00Z',
  version,
});

const pagina = (content: unknown[], pendientes = content.length) => ({
  content,
  page: 0,
  size: 10,
  totalPages: 1,
  totalElements: content.length,
  pendientes,
});

/**
 * La bandeja de pedidos de prueba: que entre en los pendientes con su contador, que "Dar de alta"
 * lleve el pedido al alta y que descartar mande el motivo con la version leida.
 */
describe('PedidosDePruebaPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PedidosDePruebaPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('entra en los pendientes, de a 10, con el contador y el alta prellenada por fila', async () => {
    const fixture = TestBed.createComponent(PedidosDePruebaPage);
    fixture.detectChanges();
    const listado = httpMock.expectOne((r) => r.url === LISTADO);
    expect(listado.request.params.get('estado')).toBe('PENDIENTE');
    expect(listado.request.params.get('size')).toBe('10');
    listado.flush(pagina([pedido(1), pedido(2)], 5));
    await estabilizar(fixture);

    expect(texto(fixture, '[data-testid="pedidos-pendientes"]')).toBe('5 pendientes');
    expect(texto(fixture, 'table')).toContain('Kinesiología y Actividades');
    const alta = fixture.nativeElement.querySelector('a[principal]') as HTMLAnchorElement;
    expect(alta.getAttribute('href')).toBe('/plataforma/centros/nuevo?solicitud=1');
  });

  it('descarta con el motivo y la versión leída, avisa y relee la bandeja', async () => {
    const fixture = await abrir([pedido(1, 'PENDIENTE', 3)]);
    clickPorTexto(fixture, 'Descartar');
    await estabilizar(fixture);

    const motivo = fixture.nativeElement.querySelector(
      '#pedido-motivo-descarte',
    ) as HTMLInputElement;
    motivo.value = '  Duplicado  ';
    motivo.dispatchEvent(new Event('input'));
    (
      fixture.nativeElement.querySelector('app-panel-lateral form') as HTMLFormElement
    ).dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    const descarte = httpMock.expectOne(`${LISTADO}/1/descartar`);
    expect(descarte.request.method).toBe('POST');
    expect(descarte.request.body).toEqual({ motivo: 'Duplicado', version: 3 });
    descarte.flush(pedido(1, 'DESCARTADA', 4));
    httpMock.expectOne((r) => r.url === LISTADO).flush(pagina([], 0));
    await estabilizar(fixture);

    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('Pedido descartado');
    expect(fixture.nativeElement.querySelector('app-panel-lateral')).toBeNull();
  });

  it('si otra persona lo resolvió antes, lo dice, relee el pedido y la bandeja', async () => {
    const fixture = await abrir([pedido(1)]);
    clickPorTexto(fixture, 'Descartar');
    await estabilizar(fixture);
    const motivo = fixture.nativeElement.querySelector(
      '#pedido-motivo-descarte',
    ) as HTMLInputElement;
    motivo.value = 'Duplicado';
    motivo.dispatchEvent(new Event('input'));
    (
      fixture.nativeElement.querySelector('app-panel-lateral form') as HTMLFormElement
    ).dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    httpMock
      .expectOne(`${LISTADO}/1/descartar`)
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    httpMock.expectOne(`${LISTADO}/1`).flush(pedido(1, 'APROBADA', 1));
    httpMock.expectOne((r) => r.url === LISTADO).flush(pagina([], 0));
    await estabilizar(fixture);

    expect(texto(fixture, 'app-panel-lateral app-alerta')).toContain(
      'Otra persona ya resolvió este pedido',
    );
    expect(texto(fixture, 'app-panel-lateral .detalle')).toContain('Aprobado');
  });

  async function abrir(pedidos: unknown[]): Promise<ComponentFixture<PedidosDePruebaPage>> {
    const fixture = TestBed.createComponent(PedidosDePruebaPage);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === LISTADO).flush(pagina(pedidos));
    await estabilizar(fixture);
    return fixture;
  }

  function clickPorTexto(fixture: ComponentFixture<PedidosDePruebaPage>, rotulo: string): void {
    const boton = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => b.textContent?.trim() === rotulo);
    boton!.click();
    fixture.detectChanges();
  }

  async function estabilizar(fixture: ComponentFixture<PedidosDePruebaPage>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<PedidosDePruebaPage>, selector: string): string {
    return (
      (fixture.nativeElement as HTMLElement).querySelector(selector)?.textContent?.trim() ?? ''
    );
  }
});
