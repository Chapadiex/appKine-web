import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { OrganizationPage } from './organization-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const ORGANIZACION = {
  id: 1,
  name: 'Centro Kinesico Belgrano',
  slug: 'centro-kinesico-belgrano',
  timezone: 'America/Argentina/Buenos_Aires',
  operationalStatus: 'ACTIVA',
  active: true,
  version: 0,
};

/**
 * Spec de la pantalla de organizacion (AKINE-01.01).
 *
 * <p>Cubre los estados obligatorios de ADR-0005 y, sobre todo, la reaccion a
 * `contextEpoch`: una pantalla que no recarga al cambiar de contexto deja datos del tenant
 * A visibles bajo el tenant B.
 */
describe('OrganizationPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrganizationPage],
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

  it('sin contexto elegido no pide nada y ofrece ir a elegirlo', () => {
    const fixture = TestBed.createComponent(OrganizationPage);
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Todavia no elegiste un contexto');
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).toBeTruthy();
    httpMock.expectNone(() => true);
  });

  it('muestra el estado de carga antes de la respuesta', () => {
    tenantContext.select({ organizationId: 1, organizationName: 'Belgrano' });
    const fixture = TestBed.createComponent(OrganizationPage);
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Cargando los datos del centro');
    httpMock.expectOne('/api/v1/organizations/1').flush(ORGANIZACION);
  });

  it('muestra los datos del centro por nombre, no por id', async () => {
    tenantContext.select({ organizationId: 1, organizationName: 'Belgrano' });
    const fixture = TestBed.createComponent(OrganizationPage);
    fixture.detectChanges();

    httpMock.expectOne('/api/v1/organizations/1').flush(ORGANIZACION);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Centro Kinesico Belgrano');
    expect(texto(fixture)).toContain('America/Argentina/Buenos_Aires');
  });

  it('avisa cuando la organizacion esta dada de baja', async () => {
    tenantContext.select({ organizationId: 1, organizationName: 'Belgrano' });
    const fixture = TestBed.createComponent(OrganizationPage);
    fixture.detectChanges();

    httpMock
      .expectOne('/api/v1/organizations/1')
      .flush({ ...ORGANIZACION, active: false, operationalStatus: 'BAJA' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('dada de baja');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('recarga al cambiar de contexto y no deja los datos del tenant anterior', async () => {
    tenantContext.select({ organizationId: 1, organizationName: 'Belgrano' });
    const fixture = TestBed.createComponent(OrganizationPage);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/organizations/1').flush(ORGANIZACION);
    await fixture.whenStable();
    fixture.detectChanges();

    tenantContext.select({ organizationId: 2, organizationName: 'Caballito' });
    fixture.detectChanges();

    // El pedido sale contra la organizacion nueva, no contra la vieja.
    httpMock
      .expectOne('/api/v1/organizations/2')
      .flush({ ...ORGANIZACION, id: 2, name: 'Centro Kinesico Caballito' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Centro Kinesico Caballito');
    expect(texto(fixture)).not.toContain('Centro Kinesico Belgrano');
  });

  it('un fallo de red se muestra como alerta con reintento', async () => {
    tenantContext.select({ organizationId: 1, organizationName: 'Belgrano' });
    const fixture = TestBed.createComponent(OrganizationPage);
    fixture.detectChanges();

    httpMock
      .expectOne('/api/v1/organizations/1')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No se pudo contactar al servidor');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();

    fixture.nativeElement.querySelector('button')?.click();
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/organizations/1').flush(ORGANIZACION);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Centro Kinesico Belgrano');
  });

  it('un missing-tenant-context ofrece elegir contexto, no reintentar en vano', async () => {
    tenantContext.select({ organizationId: 1, organizationName: 'Belgrano' });
    const fixture = TestBed.createComponent(OrganizationPage);
    fixture.detectChanges();

    httpMock.expectOne('/api/v1/organizations/1').flush(
      {
        type: 'https://akine.app/problems/missing-tenant-context',
        detail: 'No hay contexto de tenant',
      },
      { status: 403, statusText: 'Forbidden' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    // Reintentar sin cambiar nada volveria a fallar exactamente igual.
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).toBeTruthy();
  });

  it('un 404 no distingue inexistente de ajena, igual que el backend', async () => {
    tenantContext.select({ organizationId: 9, organizationName: 'Otra' });
    const fixture = TestBed.createComponent(OrganizationPage);
    fixture.detectChanges();

    httpMock
      .expectOne('/api/v1/organizations/9')
      .flush(
        { type: 'https://akine.app/problems/not-found' },
        { status: 404, statusText: 'Not Found' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No encontramos esta organizacion');
  });

  it('ante otro error del servidor muestra el detail del backend', async () => {
    tenantContext.select({ organizationId: 1, organizationName: 'Belgrano' });
    const fixture = TestBed.createComponent(OrganizationPage);
    fixture.detectChanges();

    httpMock
      .expectOne('/api/v1/organizations/1')
      .flush(
        { type: 'https://akine.app/problems/internal-error', detail: 'Fallo interno del servidor' },
        { status: 500, statusText: 'Internal Server Error' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Fallo interno del servidor');
  });

  // --- Accesibilidad ---------------------------------------------------------------

  it(
    'no tiene violaciones de axe con los datos del centro cargados',
    async () => {
      tenantContext.select({ organizationId: 1, organizationName: 'Belgrano' });
      const fixture = TestBed.createComponent(OrganizationPage);
      fixture.detectChanges();

      httpMock.expectOne('/api/v1/organizations/1').flush(ORGANIZACION);
      await fixture.whenStable();
      fixture.detectChanges();

      // La lista de definicion `dl`/`dt`/`dd` es la estructura que axe revisa aca: un `dd`
      // fuera de su `dl` rompe la relacion etiqueta-valor sin verse en pantalla.
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it(
    'no tiene violaciones de axe sin contexto elegido',
    async () => {
      const fixture = TestBed.createComponent(OrganizationPage);
      fixture.detectChanges();

      await esperarSinViolaciones(fixture.nativeElement);
      httpMock.expectNone(() => true);
    },
    TIMEOUT_AXE,
  );
});

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}
