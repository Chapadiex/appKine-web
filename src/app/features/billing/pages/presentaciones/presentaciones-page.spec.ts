import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { PresentacionesPage } from './presentaciones-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const BASE = `/api/v1/consultorios/${CONSULTORIO}`;

const LOTE = {
  id: 77,
  numero: 12,
  estado: 'PRESENTADA',
  financiadorId: 10,
  financiadorNombre: 'OSDE Sintetica',
  periodoDesde: '2026-09-01',
  periodoHasta: '2026-09-30',
  moneda: 'ARS',
  totalPresentado: 24000,
  saldo: 24000,
};

/**
 * Bandeja de presentaciones (M21). Cubre lo que decide comportamiento: que los filtros viajen al
 * servidor, que la cuenta corriente aparezca solo con un financiador elegido, y que abrir un
 * borrador lleve al detalle del lote creado.
 */
describe('PresentacionesPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PresentacionesPage],
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

  afterEach(() => httpMock.verify());

  it('lista los lotes de la sede con estado e importes', async () => {
    const fixture = await montar([LOTE]);

    const texto = contenido(fixture);
    expect(texto).toContain('N.º 12');
    expect(texto).toContain('OSDE Sintetica');
    expect(texto).toContain('Presentada');
    expect(texto).toContain('01/09/2026 al 30/09/2026');
    expect(texto).toContain('24.000,00');
  });

  it('filtrar por financiador manda el filtro al servidor y muestra su cuenta corriente', async () => {
    const fixture = await montar([]);
    expect(contenido(fixture)).toContain('No hay lotes con esos filtros');

    elegir(fixture, '#filtro-financiador', '10');
    elegir(fixture, '#filtro-estado', 'BORRADOR');
    enviar(fixture, 0);

    const busqueda = httpMock.expectOne(
      (p) => p.url === `${BASE}/presentaciones` && p.params.get('financiadorId') === '10',
    );
    expect(busqueda.request.params.get('estado')).toBe('BORRADOR');
    busqueda.flush([LOTE]);
    httpMock
      .expectOne(`${BASE}/financiadores/10/cuenta-corriente`)
      .flush({ financiadorNombre: 'OSDE Sintetica', lotes: 3, saldo: 5000.5 });
    await estabilizar(fixture);

    expect(contenido(fixture)).toContain('Cuenta corriente de OSDE Sintetica');
    expect(contenido(fixture)).toContain('5.000,50');
  });

  it('abrir un borrador lo crea y lleva al detalle del lote', async () => {
    const fixture = await montar([]);
    const router = TestBed.inject(Router);
    const navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    elegir(fixture, '#alta-financiador', '10');
    escribir(fixture, '#alta-desde', '2026-09-01');
    escribir(fixture, '#alta-hasta', '2026-09-30');
    enviar(fixture, 1);

    const alta = httpMock.expectOne(
      (p) => p.method === 'POST' && p.url === `${BASE}/presentaciones`,
    );
    expect(alta.request.body).toEqual({
      financiadorId: 10,
      moneda: 'ARS',
      periodoDesde: '2026-09-01',
      periodoHasta: '2026-09-30',
    });
    alta.flush({ ...LOTE, id: 91, estado: 'BORRADOR' });
    await estabilizar(fixture);

    expect(navegar).toHaveBeenCalledWith(['/presentaciones', 91]);
  });

  it('no pide nada con el alta incompleta o con el periodo al reves', async () => {
    const fixture = await montar([]);

    enviar(fixture, 1);
    expect(contenido(fixture)).toContain('Elegi a que financiador se presenta.');

    elegir(fixture, '#alta-financiador', '10');
    escribir(fixture, '#alta-desde', '2026-09-30');
    escribir(fixture, '#alta-hasta', '2026-09-01');
    enviar(fixture, 1);
    await estabilizar(fixture);

    httpMock.expectNone((p) => p.method === 'POST');
    expect(contenido(fixture)).toContain('El periodo termina antes de empezar');
  });

  it('sin sede en el contexto no pide lotes y manda al selector', async () => {
    const fixture = TestBed.createComponent(PresentacionesPage);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/financiadores').flush([]);
    await estabilizar(fixture);

    httpMock.expectNone(`${BASE}/presentaciones`);
    expect(contenido(fixture)).toContain('Elegir contexto');
  });

  it(
    'no tiene violaciones de accesibilidad con lotes listados',
    async () => {
      const fixture = await montar([LOTE]);
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // ------------------------------------------------------------------------------------

  async function montar(lotes: object[]): Promise<ComponentFixture<PresentacionesPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
    const fixture = TestBed.createComponent(PresentacionesPage);
    fixture.detectChanges();
    httpMock
      .expectOne('/api/v1/financiadores')
      .flush([{ id: 10, nombre: 'OSDE Sintetica', estado: 'ACTIVO' }]);
    httpMock
      .expectOne((p: HttpRequest<unknown>) => p.url === `${BASE}/presentaciones`)
      .flush(lotes);
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<PresentacionesPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function contenido(fixture: ComponentFixture<PresentacionesPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function elegir(fixture: ComponentFixture<PresentacionesPage>, selector: string, valor: string) {
    const campo = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      selector,
    )!;
    campo.value = valor;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribir(
    fixture: ComponentFixture<PresentacionesPage>,
    selector: string,
    valor: string,
  ) {
    const campo = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(selector)!;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function enviar(fixture: ComponentFixture<PresentacionesPage>, indice: number) {
    const forms = (fixture.nativeElement as HTMLElement).querySelectorAll('form');
    forms[indice].dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }
});
