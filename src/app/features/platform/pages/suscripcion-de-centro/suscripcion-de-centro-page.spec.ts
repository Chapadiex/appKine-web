import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SuscripcionDeCentroPage } from './suscripcion-de-centro-page';
import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';

const PLANES = '/api/v1/plans';
const LECTURA = '/api/v1/platform/organizations/4/subscription';
const CAMBIO = '/api/v1/organizations/4/subscription/plan-changes';

const suscripcion = (version: number, planCode = 'BASICO', status = 'ACTIVA') => ({
  id: 1,
  organizationId: 4,
  planCode,
  planName: planCode === 'BASICO' ? 'Basico' : 'Profesional',
  status,
  version,
});

/**
 * La suscripcion de un centro desde la consola (D3, `appKine-api` #133). Lo que importa: que la
 * version del cambio de plan salga de la lectura de plataforma —no del GET del tenant, que sin
 * soporte es 403— y que una version vieja relea en vez de dejar al operador sin salida.
 */
describe('SuscripcionDeCentroPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SuscripcionDeCentroPage],
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

  it('lee la suscripcion por la ruta de plataforma y cambia el plan con esa version', async () => {
    const fixture = await buscar('4');
    httpMock.expectNone('/api/v1/organizations/4/subscription');
    httpMock.expectOne(LECTURA).flush(suscripcion(7));
    await estabilizar(fixture);
    expect(texto(fixture, '[data-testid="suscripcion-version"]')).toBe('7');

    elegir(fixture, '#suscripcion-plan-nuevo', 'PROFESIONAL');
    enviar(fixture, 1);
    const cambio = httpMock.expectOne(CAMBIO);
    expect(cambio.request.method).toBe('POST');
    expect(cambio.request.body).toEqual({ planCode: 'PROFESIONAL', expectedVersion: 7 });
    cambio.flush({
      applied: true,
      warnings: [{ code: 'MAX_SEDES', currentUsage: 3, limitValue: 2, exceeded: true }],
    });
    httpMock.expectOne(LECTURA).flush(suscripcion(8, 'PROFESIONAL'));
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('El centro paso al plan Profesional.');
    expect(texto(fixture, '[data-testid="suscripcion-excedidos"]')).toContain(
      'MAX_SEDES: 3 en uso, el plan admite 2',
    );
    expect(texto(fixture, '[data-testid="suscripcion-version"]')).toBe('8');
  });

  it('una version vieja no aplica nada, lo dice y relee la suscripcion', async () => {
    const fixture = await buscar('4');
    httpMock.expectOne(LECTURA).flush(suscripcion(7));
    await estabilizar(fixture);

    elegir(fixture, '#suscripcion-plan-nuevo', 'PROFESIONAL');
    enviar(fixture, 1);
    httpMock
      .expectOne(CAMBIO)
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    httpMock.expectOne(LECTURA).flush(suscripcion(9));
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No se aplico nada');
    expect(texto(fixture, '[data-testid="suscripcion-version"]')).toBe('9');
  });

  it('con la suscripcion suspendida no ofrece cambiar el plan', async () => {
    const fixture = await buscar('4');
    httpMock.expectOne(LECTURA).flush(suscripcion(2, 'BASICO', 'SUSPENDIDA'));
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('el plan solo se cambia con la suscripcion activa');
    expect(fixture.nativeElement.querySelector('#suscripcion-plan-nuevo')).toBeNull();
  });

  it('un numero invalido no sale, y una organizacion inexistente se explica', async () => {
    const fixture = await buscar('abc');
    httpMock.expectNone(() => true);
    expect(texto(fixture)).toContain('Escribi el numero de la organizacion');

    escribir(fixture, '4');
    enviar(fixture, 0);
    httpMock
      .expectOne(LECTURA)
      .flush(
        { type: 'https://akine.app/problems/not-found', status: 404 },
        { status: 404, statusText: 'Not Found' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('No hay una organizacion vigente con ese numero');
  });

  it(
    'con una suscripcion cargada no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await buscar('4');
      httpMock.expectOne(LECTURA).flush(suscripcion(7));
      await estabilizar(fixture);
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  async function buscar(valor: string): Promise<ComponentFixture<SuscripcionDeCentroPage>> {
    const fixture = TestBed.createComponent(SuscripcionDeCentroPage);
    fixture.detectChanges();
    httpMock.expectOne(PLANES).flush([
      { code: 'BASICO', name: 'Basico' },
      { code: 'PROFESIONAL', name: 'Profesional' },
    ]);
    await estabilizar(fixture);
    escribir(fixture, valor);
    enviar(fixture, 0);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<SuscripcionDeCentroPage>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function escribir(fixture: ComponentFixture<SuscripcionDeCentroPage>, valor: string): void {
    const campo = fixture.nativeElement.querySelector(
      '#suscripcion-organizacion',
    ) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function elegir(
    fixture: ComponentFixture<SuscripcionDeCentroPage>,
    selector: string,
    valor: string,
  ): void {
    const select = fixture.nativeElement.querySelector(selector) as HTMLSelectElement;
    select.value = valor;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  /** Envia el formulario numero `indice` de la pantalla (0: buscar, 1: cambiar el plan). */
  function enviar(fixture: ComponentFixture<SuscripcionDeCentroPage>, indice: number): void {
    const formularios = fixture.nativeElement.querySelectorAll('form');
    (formularios[indice] as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<SuscripcionDeCentroPage>, selector?: string): string {
    const raiz = fixture.nativeElement as HTMLElement;
    const elemento = selector ? raiz.querySelector(selector) : raiz;
    return elemento?.textContent?.trim() ?? '';
  }
});
