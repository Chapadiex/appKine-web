import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CatalogoFinanciadoresPage } from './catalogo-financiadores-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';
import { traducirErrorCatalogo } from '../../models/catalogo-financiadores-errors';

const CATALOGO = '/api/v1/platform/catalogo-financiadores';

const OSDE = {
  id: 11,
  codigo: 'OSDE',
  nombre: 'OSDE',
  tipo: 'PREPAGA',
  cuit: '30546741253',
  estado: 'ACTIVO',
  version: 2,
  planes: [
    {
      id: 5,
      codigo: '210',
      nombre: 'Plan 210',
      estado: 'ACTIVO',
      vigenciaDesde: '2026-01-01',
      version: 0,
    },
  ],
};

/**
 * Spec del catalogo global para la plataforma (DP-43, U-12): listar con filtros, alta, edicion sin
 * codigo, baja con motivo obligatorio, y los planes con sus tres operaciones.
 */
describe('CatalogoFinanciadoresPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogoFinanciadoresPage],
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

  it(
    'lista activos por defecto con sus planes',
    async () => {
      const fixture = await montar();
      expect(texto(fixture)).toContain('OSDE');
      expect(texto(fixture)).toContain('Plan 210');
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it('filtra por texto, estado y tipo', async () => {
    const fixture = await montar();
    escribir(fixture, '#catalogo-plataforma-busqueda', 'osde');
    elegir(fixture, '#catalogo-plataforma-estado', 'TODOS');
    elegir(fixture, '#catalogo-plataforma-tipo', 'PREPAGA');
    boton(fixture, 'Buscar')?.click();
    const pedido = httpMock.expectOne((p) => p.url === CATALOGO);
    expect(pedido.request.params.get('q')).toBe('osde');
    expect(pedido.request.params.get('estado')).toBe('TODOS');
    expect(pedido.request.params.get('tipo')).toBe('PREPAGA');
    pedido.flush([]);
    await asentar(fixture);
    expect(texto(fixture)).toContain('Ninguna entrada del catálogo coincide');
  });

  it('da de alta un financiador y relee', async () => {
    const fixture = await montar();
    boton(fixture, 'Nuevo financiador')?.click();
    fixture.detectChanges();

    // Vacio no manda nada.
    enviarFormulario(fixture);
    expect(texto(fixture)).toContain('El código es obligatorio');
    httpMock.expectNone((p) => p.method === 'POST');

    escribir(fixture, '#catalogo-financiador-codigo', 'IOSFA');
    escribir(fixture, '#catalogo-financiador-nombre', 'IOSFA');
    elegir(fixture, '#catalogo-financiador-tipo', 'OBRA_SOCIAL');
    enviarFormulario(fixture);

    const pedido = httpMock.expectOne((p) => p.method === 'POST' && p.url === CATALOGO);
    expect(pedido.request.body).toEqual({ codigo: 'IOSFA', nombre: 'IOSFA', tipo: 'OBRA_SOCIAL' });
    pedido.flush({ id: 12 }, { status: 201, statusText: 'Created' });
    await asentar(fixture);
    httpMock.expectOne((p) => p.method === 'GET' && p.url === CATALOGO).flush([OSDE]);
    await asentar(fixture);
    expect(texto(fixture)).toContain('quedo en el catalogo');
  });

  it('edita sin el codigo y con la version leida', async () => {
    const fixture = await montar();
    boton(fixture, 'Editar OSDE')?.click();
    fixture.detectChanges();
    const codigo = campo(fixture, '#catalogo-financiador-codigo');
    expect(codigo.disabled).toBe(true);
    escribir(fixture, '#catalogo-financiador-nombre', 'OSDE Binario');
    enviarFormulario(fixture);

    const pedido = httpMock.expectOne((p) => p.method === 'PUT' && p.url === `${CATALOGO}/11`);
    expect(pedido.request.body).toMatchObject({
      nombre: 'OSDE Binario',
      tipo: 'PREPAGA',
      cuit: '30546741253',
      expectedVersion: 2,
    });
    expect(pedido.request.body).not.toHaveProperty('codigo');
    pedido.flush({ ...OSDE, nombre: 'OSDE Binario', version: 3 });
    await asentar(fixture);
    httpMock.expectOne((p) => p.method === 'GET' && p.url === CATALOGO).flush([OSDE]);
    await asentar(fixture);
  });

  it('la version vieja relee el catalogo y lo explica', async () => {
    const fixture = await montar();
    boton(fixture, 'Editar OSDE')?.click();
    fixture.detectChanges();
    enviarFormulario(fixture);
    httpMock
      .expectOne((p) => p.method === 'PUT')
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    await asentar(fixture);
    httpMock.expectOne((p) => p.method === 'GET' && p.url === CATALOGO).flush([OSDE]);
    await asentar(fixture);
    expect(texto(fixture)).toContain('Otro cambio llego a esta entrada');
  });

  it('la baja exige motivo', async () => {
    const fixture = await montar();
    boton(fixture, 'Dar de baja OSDE')?.click();
    fixture.detectChanges();
    enviarFormulario(fixture);
    httpMock.expectNone((p) => p.method === 'DELETE');

    escribir(fixture, '#catalogo-baja-financiador-motivo', 'Se fusiono');
    enviarFormulario(fixture);
    const pedido = httpMock.expectOne((p) => p.method === 'DELETE' && p.url === `${CATALOGO}/11`);
    expect(pedido.request.body).toEqual({ reason: 'Se fusiono' });
    pedido.flush({});
    await asentar(fixture);
    httpMock.expectOne((p) => p.method === 'GET' && p.url === CATALOGO).flush([]);
    await asentar(fixture);
    expect(texto(fixture)).toContain('se dio de baja del catalogo');
  });

  it('planes: alta, edicion y baja', async () => {
    const fixture = await montar();

    boton(fixture, 'Agregar un plan a OSDE')?.click();
    fixture.detectChanges();
    escribir(fixture, '#catalogo-plan-codigo', '310');
    escribir(fixture, '#catalogo-plan-nombre', 'Plan 310');
    escribir(fixture, '#catalogo-plan-desde', '2026-11-01');
    enviarFormulario(fixture);
    const alta = httpMock.expectOne(
      (p) => p.method === 'POST' && p.url === `${CATALOGO}/11/planes`,
    );
    expect(alta.request.body).toMatchObject({
      codigo: '310',
      nombre: 'Plan 310',
      vigenciaDesde: '2026-11-01',
      requiereAutorizacion: false,
    });
    alta.flush({ id: 6 });
    await asentar(fixture);
    httpMock.expectOne((p) => p.method === 'GET' && p.url === CATALOGO).flush([OSDE]);
    await asentar(fixture);

    boton(fixture, 'Editar el plan Plan 210')?.click();
    fixture.detectChanges();
    expect(campo(fixture, '#catalogo-plan-codigo').disabled).toBe(true);
    enviarFormulario(fixture);
    const edicion = httpMock.expectOne(
      (p) => p.method === 'PUT' && p.url === `${CATALOGO}/11/planes/5`,
    );
    expect(edicion.request.body).toMatchObject({ nombre: 'Plan 210', expectedVersion: 0 });
    edicion.flush({});
    await asentar(fixture);
    httpMock.expectOne((p) => p.method === 'GET' && p.url === CATALOGO).flush([OSDE]);
    await asentar(fixture);

    boton(fixture, 'Dar de baja el plan Plan 210')?.click();
    fixture.detectChanges();
    escribir(fixture, '#catalogo-baja-plan-motivo', 'Discontinuado');
    enviarFormulario(fixture);
    const baja = httpMock.expectOne(
      (p) => p.method === 'DELETE' && p.url === `${CATALOGO}/11/planes/5`,
    );
    expect(baja.request.body).toEqual({ reason: 'Discontinuado' });
    baja.flush({});
    await asentar(fixture);
    httpMock.expectOne((p) => p.method === 'GET' && p.url === CATALOGO).flush([OSDE]);
    await asentar(fixture);
  });

  it('el listado que falla ofrece reintentar', async () => {
    const fixture = TestBed.createComponent(CatalogoFinanciadoresPage);
    fixture.detectChanges();
    httpMock
      .expectOne((p) => p.url === CATALOGO)
      .flush(
        { type: 'https://akine.app/problems/forbidden', status: 403 },
        { status: 403, statusText: 'Forbidden' },
      );
    await asentar(fixture);
    expect(texto(fixture)).toContain('ya no administra la plataforma');
    boton(fixture, 'Reintentar')?.click();
    httpMock.expectOne((p) => p.url === CATALOGO).flush([]);
  });

  it('traduce los problem types del catalogo', () => {
    expect(traducirErrorCatalogo(new Error('x')).causa).toBe('otro');
  });

  async function montar(): Promise<ComponentFixture<CatalogoFinanciadoresPage>> {
    const fixture = TestBed.createComponent(CatalogoFinanciadoresPage);
    fixture.detectChanges();
    const pedido = httpMock.expectOne((p) => p.url === CATALOGO);
    expect(pedido.request.params.get('estado')).toBe('ACTIVO');
    pedido.flush([OSDE]);
    await asentar(fixture);
    return fixture;
  }

  async function asentar(fixture: ComponentFixture<CatalogoFinanciadoresPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<CatalogoFinanciadoresPage>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  function campo(
    fixture: ComponentFixture<CatalogoFinanciadoresPage>,
    selector: string,
  ): HTMLInputElement {
    return (fixture.nativeElement as HTMLElement).querySelector(selector) as HTMLInputElement;
  }

  function escribir(
    fixture: ComponentFixture<CatalogoFinanciadoresPage>,
    selector: string,
    valor: string,
  ): void {
    const control = campo(fixture, selector);
    control.value = valor;
    control.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function elegir(
    fixture: ComponentFixture<CatalogoFinanciadoresPage>,
    selector: string,
    valor: string,
  ): void {
    const control = (fixture.nativeElement as HTMLElement).querySelector(
      selector,
    ) as HTMLSelectElement;
    control.value = valor;
    control.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function enviarFormulario(fixture: ComponentFixture<CatalogoFinanciadoresPage>): void {
    const formulario = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="formulario-catalogo"], app-confirmacion-con-motivo form',
    ) as HTMLFormElement;
    formulario.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  function boton(
    fixture: ComponentFixture<CatalogoFinanciadoresPage>,
    textoBoton: string,
  ): HTMLButtonElement | null {
    return (
      (
        Array.from(
          (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
        ) as HTMLButtonElement[]
      ).find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === textoBoton) ?? null
    );
  }
});
