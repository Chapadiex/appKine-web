import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CasosDeLaHistoria } from './casos-de-la-historia';
import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { VisitaClinica } from '../../services/visita-clinica';

const CASOS = '/api/v1/historias-clinicas/88/casos';
const OFERTAS = '/api/v1/consultorios/3/ofertas';
const HABILITACIONES = '/api/v1/consultorios/3/ofertas/14/habilitaciones';

const ACTIVO = {
  id: 9,
  numeroCaso: 1,
  estado: 'ACTIVO',
  ofertaId: 14,
  ofertaConsultorioId: 3,
  diagnosticoPresuntivo: 'Lumbalgia',
  equipo: [{ profesionalMembershipId: 31, rol: 'RESPONSABLE', vigente: true }],
};
const CERRADO = { ...ACTIVO, id: 8, numeroCaso: 2, estado: 'CERRADO', equipo: [] };

/**
 * Los casos de la historia (D-b): activos y cerrados por separado, con nombres de la sede, y el
 * alta compacta con el aviso de posible duplicado, que se resuelve CONFIRMANDO, no reintentando.
 */
describe('CasosDeLaHistoria', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CasosDeLaHistoria],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', children: [] }]),
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

  afterEach(() => httpMock.verify());

  it('separa activos de historicos y muestra la oferta y el equipo por nombre', async () => {
    const fixture = await montar();
    expect(texto(fixture)).toContain('Caso 1 · Kinesiologia');
    expect(texto(fixture)).toContain('Lopez, Maria (Responsable)');
    const cerrados = (fixture.nativeElement as HTMLElement).querySelector(
      '[aria-label="Casos cerrados"]',
    );
    expect(cerrados?.textContent).toContain('Caso 2');
  });

  it('el posible duplicado muestra los candidatos y confirmar reenvia con la marca', async () => {
    const fixture = await montar();
    elegir(fixture, '#caso-oferta', '14');
    httpMock.expectOne(HABILITACIONES).flush({ profesionales: [] });
    escribir(fixture, '#caso-diagnostico', 'Cervicalgia');
    enviar(fixture);

    httpMock
      .expectOne((r) => r.url === CASOS && r.method === 'POST')
      .flush(
        {
          type: 'https://akine.app/problems/caso-clinico-posible-duplicado',
          status: 409,
          candidatos: [9],
        },
        { status: 409, statusText: 'C' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Ver el caso 1');

    const confirmar = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.includes('Abrir igual'));
    confirmar?.click();
    const segundo = httpMock.expectOne((r) => r.url === CASOS && r.method === 'POST');
    expect(segundo.request.body).toEqual({
      ofertaId: 14,
      diagnosticoPresuntivo: 'Cervicalgia',
      confirmaPosibleDuplicado: true,
    });
    segundo.flush({ id: 10 });
  });

  async function montar(): Promise<ComponentFixture<CasosDeLaHistoria>> {
    const fixture = TestBed.createComponent(CasosDeLaHistoria);
    fixture.componentRef.setInput('historiaClinicaId', 88);
    await estabilizar(fixture);
    httpMock
      .expectOne(OFERTAS + '?estado=TODOS')
      .flush([{ id: 14, nombreComercial: 'Kinesiologia', estado: 'ACTIVO' }]);
    httpMock.expectOne((r) => r.url === CASOS && r.method === 'GET').flush([ACTIVO, CERRADO]);
    await estabilizar(fixture);
    httpMock
      .expectOne(HABILITACIONES)
      .flush({ profesionales: [{ membershipId: 31, nombre: 'Lopez, Maria' }] });
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<CasosDeLaHistoria>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<CasosDeLaHistoria>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function elegir(fixture: ComponentFixture<CasosDeLaHistoria>, sel: string, valor: string): void {
    const select = (fixture.nativeElement as HTMLElement).querySelector(sel) as HTMLSelectElement;
    select.value = valor;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribir(
    fixture: ComponentFixture<CasosDeLaHistoria>,
    sel: string,
    valor: string,
  ): void {
    const campo = (fixture.nativeElement as HTMLElement).querySelector(sel) as HTMLTextAreaElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function enviar(fixture: ComponentFixture<CasosDeLaHistoria>): void {
    const form = (fixture.nativeElement as HTMLElement).querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }
});
