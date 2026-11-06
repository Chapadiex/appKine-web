import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { OrganizationPage } from './organization-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';
import { PERMISO_TENANT_UPDATE } from '../../../../core/models/permisos';

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

  afterEach(() => {
    // El boton de editar los datos fiscales va detras de `*akinePermiso`, que lee los permisos
    // una vez: se responde lo que quedo pendiente antes de verificar.
    httpMock.match('/api/v1/me/permissions').forEach((pedido) => pedido.flush({ permissions: [] }));
    httpMock.verify();
  });

  it('edita los datos fiscales con un PATCH que lleva solo lo que cambio y la version', async () => {
    tenantContext.select({ organizationId: 1, organizationName: 'Belgrano' });
    const fixture = TestBed.createComponent(OrganizationPage);
    fixture.detectChanges();
    httpMock
      .expectOne('/api/v1/organizations/1')
      .flush({ ...ORGANIZACION, version: 4, taxId: '30-71094127-7' });
    await fixture.whenStable();
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/me/permissions').flush({ permissions: [PERMISO_TENANT_UPDATE] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('30-71094127-7');
    pulsar(fixture, 'Editar datos fiscales');
    escribir(fixture, '#fiscal-legalName', 'Centro Belgrano SRL');
    escribir(fixture, '#fiscal-taxId', '30-71094127-9');
    pulsar(fixture, 'Guardar los cambios');
    // Un CUIT que no cierra no sale a la red.
    expect(texto(fixture)).toContain('El CUIT no es válido');
    httpMock.expectNone('/api/v1/organizations/1');

    escribir(fixture, '#fiscal-taxId', '30-71094127-7');
    pulsar(fixture, 'Guardar los cambios');
    const patch = httpMock.expectOne(
      (pedido) => pedido.method === 'PATCH' && pedido.url === '/api/v1/organizations/1',
    );
    expect(patch.request.body).toEqual({ version: 4, legalName: 'Centro Belgrano SRL' });
    patch.flush({
      ...ORGANIZACION,
      version: 5,
      legalName: 'Centro Belgrano SRL',
      taxId: '30-71094127-7',
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Centro Belgrano SRL');
    expect(fixture.nativeElement.querySelector('#fiscal-legalName')).toBeNull();
  });

  it('sin contexto elegido no pide nada y ofrece ir a elegirlo', () => {
    const fixture = TestBed.createComponent(OrganizationPage);
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Todavía no elegiste un contexto');
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

  /**
   * La puerta de entrada de las features que no cuelgan de `/organizacion`.
   *
   * <p>Espacios y horarios son de la SEDE del contexto activo, asi que sus rutas viven fuera de
   * `/organizacion` y esta pantalla es el unico lugar de la aplicacion desde el que se llega a
   * ellas. Sin estos enlaces las dos features quedan alcanzables solo escribiendo la URL: la de
   * horarios estuvo asi toda la etapa AKINE-02.04, con cuatro pantallas que se enlazan entre si
   * y ninguna entrada desde afuera.
   */
  it('ofrece la entrada a los espacios y a los horarios de la sede activa', async () => {
    tenantContext.select({ organizationId: 1, organizationName: 'Belgrano' });
    const fixture = TestBed.createComponent(OrganizationPage);
    fixture.detectChanges();

    httpMock.expectOne('/api/v1/organizations/1').flush(ORGANIZACION);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('a[href="/espacios"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('a[href="/horarios"]')).toBeTruthy();
    expect(texto(fixture)).toContain('horarios de los profesionales');
  });

  it('avisa cuando la organización esta dada de baja', async () => {
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

    fixture.nativeElement
      .querySelector('button:not(.ayuda-contextual__boton):not(.ayuda-contextual__cerrar)')
      ?.click();
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
    expect(
      fixture.nativeElement.querySelector(
        'button:not(.ayuda-contextual__boton):not(.ayuda-contextual__cerrar)',
      ),
    ).toBeNull();
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

    expect(texto(fixture)).toContain('No encontramos esta organización');
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

function escribir(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const campo = fixture.nativeElement.querySelector<HTMLInputElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el campo ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function pulsar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, rotulo: string) {
  const boton = Array.from(
    fixture.nativeElement.querySelectorAll<HTMLButtonElement>('button'),
  ).find((candidato) => candidato.textContent?.includes(rotulo));
  if (boton === undefined) {
    throw new Error(`No existe el botón ${rotulo}`);
  }
  boton.click();
  fixture.detectChanges();
}
