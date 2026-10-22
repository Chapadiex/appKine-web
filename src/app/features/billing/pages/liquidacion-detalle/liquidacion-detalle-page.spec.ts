import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LiquidacionDetallePage } from './liquidacion-detalle-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const URL = `/api/v1/consultorios/${CONSULTORIO}/honorarios/liquidaciones/77`;

const LIQUIDACION = {
  id: 77,
  colaboradorMembershipId: 7,
  colaboradorNombre: 'Lic. Sintetica',
  desde: '2026-10-01',
  hasta: '2026-10-31',
  estado: 'VIGENTE',
  egresoId: 900,
  egresoEstado: 'BORRADOR',
  importeTotal: 499.99,
  moneda: 'ARS',
  confirmadaEn: '2026-10-18T15:00:00Z',
  clases: [
    {
      claseId: 101,
      fecha: '2026-10-05',
      titulo: 'Pilates lunes',
      presentes: 2,
      importePorParticipante: 500,
      importeClase: 999.99,
      instructores: 2,
      posicion: 2,
      importeColaborador: 499.99,
    },
  ],
};

describe('LiquidacionDetallePage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LiquidacionDetallePage],
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
    'muestra el snapshot por clase y enlaza al egreso',
    async () => {
      const fixture = await montar(LIQUIDACION);
      const texto = contenido(fixture);
      expect(texto).toContain('Lic. Sintetica');
      expect(texto).toContain('Vigente');
      expect(texto).toContain('01/10/2026 al 31/10/2026');
      expect(texto).toContain('499,99');
      expect(texto).toContain('Parte 2 de 2');
      expect(texto).toContain('(Borrador)');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('a[href="/egresos/900"]'),
      ).not.toBeNull();
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  it('una liberada dice que sus clases vuelven a poder liquidarse', async () => {
    const fixture = await montar({
      ...LIQUIDACION,
      estado: 'LIBERADA',
      egresoEstado: 'ANULADO',
      liberadaEn: '2026-10-19T12:00:00Z',
      colaboradorNombre: undefined,
    });
    expect(contenido(fixture)).toContain('Liberada');
    expect(contenido(fixture)).toContain('vuelven a poder liquidarse');
    expect(contenido(fixture)).toContain('Colaborador #7');
  });

  it('una liquidación ajena da 404 y se puede reintentar', async () => {
    seleccionarSede();
    const fixture = crear();
    httpMock.expectOne(URL).flush({ status: 404 }, { status: 404, statusText: 'Not Found' });
    await estabilizar(fixture);
    expect(contenido(fixture)).toContain('No se pudo cargar la liquidación');
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button')!.click();
    httpMock.expectOne(URL).flush(LIQUIDACION);
    await estabilizar(fixture);
    expect(contenido(fixture)).toContain('Pilates lunes');
  });

  it('sin sede manda a elegir contexto', async () => {
    const fixture = crear();
    await estabilizar(fixture);
    expect(contenido(fixture)).toContain('Elegir contexto');
  });

  function seleccionarSede(): void {
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
  }

  function crear(): ComponentFixture<LiquidacionDetallePage> {
    const fixture = TestBed.createComponent(LiquidacionDetallePage);
    fixture.componentRef.setInput('liquidacionId', '77');
    fixture.detectChanges();
    return fixture;
  }

  async function montar(liquidacion: object): Promise<ComponentFixture<LiquidacionDetallePage>> {
    seleccionarSede();
    const fixture = crear();
    httpMock.expectOne(URL).flush(liquidacion);
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<unknown>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function contenido(fixture: ComponentFixture<unknown>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }
});
