import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PlanPage } from './plan-page';
import { provideApi } from '../../../api/generated/provide-api';
import { errorInterceptor } from '../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../core/testing/axe';
import { VisitaClinica } from '../services/visita-clinica';

const CASO = '/api/v1/casos-clinicos/9';
const PLANES = `${CASO}/planes`;
const PLAN = '/api/v1/planes-tratamiento/5';

const BORRADOR = {
  id: 5,
  numeroPlan: 1,
  estado: 'BORRADOR',
  version: 2,
  versionVigente: {
    numeroVersion: 1,
    objetivos: 'Fortalecer',
    items: [{ id: 1, ofertaId: 14, cantidadPlanificada: 10 }],
  },
};

/**
 * El plan de tratamiento (D-c). Lo que el E2E no aisla: que el editor mande exactamente lo que el
 * contrato pide —la oferta elegida, las cantidades como numeros, sin campos vacios—, que cada
 * transicion lleve la version leida y que `plan-vivo-en-el-caso` ofrezca ir al plan que ocupa el
 * lugar.
 */
describe('PlanPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        VisitaClinica,
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 3,
      consultorioName: 'Sede',
    });
    TestBed.inject(VisitaClinica).iniciar(12);
  });

  afterEach(() => {
    httpMock.match((r) => r.url.startsWith('/api/v1/organizations')).forEach((r) => r.flush([]));
    httpMock.verify();
  });

  it('crear manda el contenido del editor con numeros y sin campos vacios', async () => {
    const fixture = await montar([]);
    clic(fixture, 'Crear un plan');
    escribir(fixture, '#plan-objetivos', 'Fortalecer cuadriceps');
    escribir(fixture, '#plan-duracion', '6');
    elegir(fixture, '#item-oferta-0', '14');
    escribir(fixture, '#item-planificadas-0', '10');
    clic(fixture, 'Crear el plan');

    const alta = httpMock.expectOne((r) => r.url === PLANES && r.method === 'POST');
    expect(alta.request.body).toEqual({
      objetivos: 'Fortalecer cuadriceps',
      duracionSemanas: 6,
      items: [{ ofertaId: 14, cantidadPlanificada: 10 }],
    });
    alta.flush(BORRADOR);
    await estabilizar(fixture);
    responderCarga(fixture, [BORRADOR]);
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Se creo el plan en borrador.');
  });

  it('activar manda la version leida; plan-vivo ofrece ir al que ocupa el lugar', async () => {
    const fixture = await montar([BORRADOR]);
    clic(fixture, 'Activar el plan');
    const activacion = httpMock.expectOne(`${PLAN}/activacion`);
    expect(activacion.request.body).toEqual({ expectedVersion: 2 });
    activacion.flush(
      {
        type: 'https://akine.app/problems/plan-vivo-en-el-caso',
        status: 409,
        planQueOcupaId: 4,
      },
      { status: 409, statusText: 'C' },
    );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('otro plan vigente');
    expect(botones(fixture)).toContain('Ir al plan que ocupa el lugar');
  });

  it(
    'con un plan cargado no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar([BORRADOR]);
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  it('cada item muestra la vigencia de su autorizacion y marca la vencida', async () => {
    const version = {
      ...BORRADOR.versionVigente,
      items: [
        {
          id: 1,
          ofertaId: 14,
          ofertaNombre: 'Kinesiologia',
          cantidadPlanificada: 10,
          autorizacionId: 3,
          autorizacionVigenciaDesde: '2020-01-01',
          autorizacionVigenciaHasta: '2020-01-31',
        },
        {
          id: 2,
          ofertaId: 15,
          ofertaNombre: 'Hidroterapia',
          cantidadPlanificada: 4,
          autorizacionId: 4,
          autorizacionVigenciaDesde: '2020-01-01',
          autorizacionVigenciaHasta: '2099-12-31',
        },
        { id: 3, ofertaId: 16, ofertaNombre: 'Masoterapia', cantidadPlanificada: 2 },
      ],
    };
    const fixture = await montar([{ ...BORRADOR, versionVigente: version }], [version]);

    const marcas = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-testid="plan-vigencia-autorizacion"]',
      ),
    );
    // El item sin autorizacion no dice nada: no hay vigencia que mostrar.
    expect(marcas.map((m) => m.textContent?.trim())).toEqual([
      'autorizacion vencida el 31/01/2020',
      'autorizacion vigente hasta el 31/12/2099 inclusive',
    ]);
    expect(marcas[0].classList).toContain('plan__vigencia--vencida');
    expect(marcas[1].classList).not.toContain('plan__vigencia--vencida');
  });

  async function montar(
    planes: unknown[],
    versiones: unknown[] = [BORRADOR.versionVigente],
  ): Promise<ComponentFixture<PlanPage>> {
    const fixture = TestBed.createComponent(PlanPage);
    fixture.componentRef.setInput('casoId', '9');
    await estabilizar(fixture);
    httpMock
      .match((r) => r.url === '/api/v1/consultorios/3/ofertas')
      .forEach((r) =>
        r.flush([{ id: 14, nombreComercial: 'Kinesiologia', estado: 'ACTIVO', vigenteHoy: true }]),
      );
    responderCarga(fixture, planes, versiones);
    await estabilizar(fixture);
    return fixture;
  }

  function responderCarga(
    fixture: ComponentFixture<PlanPage>,
    planes: unknown[],
    versiones: unknown[] = [BORRADOR.versionVigente],
  ): void {
    httpMock
      .expectOne(CASO)
      .flush({ id: 9, numeroCaso: 1, estado: 'ACTIVO', diagnosticoPresuntivo: 'Tendinopatia' });
    httpMock.expectOne((r) => r.url === PLANES && r.method === 'GET').flush(planes);
    fixture.detectChanges();
    if (planes.length > 0) {
      httpMock.expectOne(`${PLAN}/versiones`).flush(versiones);
      httpMock
        .expectOne(`${PLAN}/avance`)
        .flush({ numeroVersion: 1, items: [{ ofertaId: 14, planificadas: 10, realizadas: 0 }] });
    }
  }

  async function estabilizar(fixture: ComponentFixture<PlanPage>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<PlanPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function botones(fixture: ComponentFixture<PlanPage>): string[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).map(
      (b) => b.textContent?.trim() ?? '',
    );
  }

  function clic(fixture: ComponentFixture<PlanPage>, rotulo: string): void {
    const boton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === rotulo);
    if (!boton) throw new Error(`No hay boton "${rotulo}"`);
    boton.click();
    fixture.detectChanges();
  }

  function escribir(fixture: ComponentFixture<PlanPage>, selector: string, valor: string): void {
    const campo = (fixture.nativeElement as HTMLElement).querySelector(selector) as
      HTMLInputElement | HTMLTextAreaElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function elegir(fixture: ComponentFixture<PlanPage>, selector: string, valor: string): void {
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      selector,
    ) as HTMLSelectElement;
    select.value = valor;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }
});
