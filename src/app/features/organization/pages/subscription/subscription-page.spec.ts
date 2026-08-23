import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { SubscriptionPage } from './subscription-page';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const URL_SUSCRIPCION = '/api/v1/organizations/1/subscription';
const URL_HISTORICO = '/api/v1/organizations/1/subscription/transitions?size=20';

const SUSCRIPCION_ACTIVA = {
  id: 1,
  organizationId: 1,
  planCode: 'BASICO',
  planName: 'Basico',
  status: 'ACTIVA',
  startedAt: '2026-01-15T13:45:00Z',
  version: 0,
  allowedTargets: ['SUSPENDIDA', 'CANCELADA'],
  limits: [
    { code: 'MAX_CONSULTORIOS', currentUsage: 2, limitValue: 3, exceeded: false },
    { code: 'MAX_MIEMBROS_ACTIVOS', currentUsage: 12, exceeded: false },
  ],
};

/**
 * Spec de la pantalla de suscripcion (AKINE-01.01).
 *
 * <p>El caso que mas importa es SUSPENDIDA: el motivo <b>no viaja en la suscripcion</b> y
 * hay que sacarlo del historico. Se cubre tanto el camino en que el historico responde como
 * aquel en que falla, porque no poder recuperar una frase no puede dejar la pantalla en
 * blanco.
 */
describe('SubscriptionPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubscriptionPage],
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
    const fixture = TestBed.createComponent(SubscriptionPage);
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Todavia no elegiste un contexto');
    httpMock.expectNone(() => true);
  });

  it('muestra el estado de carga antes de la respuesta', () => {
    seleccionar();
    const fixture = TestBed.createComponent(SubscriptionPage);
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Cargando la suscripcion');
    httpMock.expectOne(URL_SUSCRIPCION).flush(SUSCRIPCION_ACTIVA);
  });

  it('con la suscripcion ACTIVA muestra plan y limites con su uso, sin pedir el historico', async () => {
    seleccionar();
    const fixture = await cargarCon(SUSCRIPCION_ACTIVA);

    expect(texto(fixture)).toContain('Suscripcion activa');
    expect(texto(fixture)).toContain('Basico');
    // Los codigos tecnicos no se muestran crudos.
    expect(texto(fixture)).toContain('Sedes habilitadas');
    expect(texto(fixture)).toContain('Miembros activos');
    // Un limite sin limitValue es ilimitado, no cero.
    expect(texto(fixture)).toContain('Sin tope');
    // El historico solo se consulta cuando hace falta el motivo de una suspension.
    httpMock.expectNone(URL_HISTORICO);
  });

  it('marca el limite excedido', async () => {
    seleccionar();
    const fixture = await cargarCon({
      ...SUSCRIPCION_ACTIVA,
      limits: [{ code: 'MAX_CONSULTORIOS', currentUsage: 4, limitValue: 3, exceeded: true }],
    });

    expect(fixture.nativeElement.querySelector('.excedido')).toBeTruthy();
  });

  it('sin limites declarados lo dice, en vez de mostrar una tabla vacia', async () => {
    seleccionar();
    const fixture = await cargarCon({ ...SUSCRIPCION_ACTIVA, limits: [] });

    expect(texto(fixture)).toContain('Este plan no declara limites');
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
  });

  it('con la suscripcion SUSPENDIDA muestra el motivo del historico y avisa de solo lectura', async () => {
    seleccionar();
    const fixture = TestBed.createComponent(SubscriptionPage);
    fixture.detectChanges();

    httpMock.expectOne(URL_SUSCRIPCION).flush({ ...SUSCRIPCION_ACTIVA, status: 'SUSPENDIDA' });
    await fixture.whenStable();

    httpMock.expectOne(URL_HISTORICO).flush({
      content: [
        { id: 3, toStatus: 'SUSPENDIDA', reason: 'Falta de pago de tres periodos' },
        { id: 1, toStatus: 'ACTIVA' },
      ],
      page: 0,
      size: 20,
      totalElements: 2,
      totalPages: 1,
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Falta de pago de tres periodos');
    expect(texto(fixture)).toContain('solo lectura');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('si el historico falla igual se pinta la suscripcion, sin el motivo', async () => {
    seleccionar();
    const fixture = TestBed.createComponent(SubscriptionPage);
    fixture.detectChanges();

    httpMock.expectOne(URL_SUSCRIPCION).flush({ ...SUSCRIPCION_ACTIVA, status: 'SUSPENDIDA' });
    await fixture.whenStable();

    httpMock
      .expectOne(URL_HISTORICO)
      .flush({ type: 'https://akine.app/problems/forbidden' }, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No pudimos recuperar el motivo');
    // Lo importante -que esta suspendida y que es solo lectura- se muestra igual.
    expect(texto(fixture)).toContain('solo lectura');
    expect(texto(fixture)).toContain('Basico');
  });

  it('con la suscripcion CANCELADA lo dice como estado final', async () => {
    seleccionar();
    const fixture = await cargarCon({ ...SUSCRIPCION_ACTIVA, status: 'CANCELADA' });

    expect(texto(fixture)).toContain('Suscripcion cancelada');
    expect(texto(fixture)).toContain('estado final');
  });

  it('un fallo de red se muestra como alerta con reintento', async () => {
    seleccionar();
    const fixture = TestBed.createComponent(SubscriptionPage);
    fixture.detectChanges();

    httpMock
      .expectOne(URL_SUSCRIPCION)
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No se pudo contactar al servidor');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();

    fixture.nativeElement.querySelector('button')?.click();
    fixture.detectChanges();
    httpMock.expectOne(URL_SUSCRIPCION).flush(SUSCRIPCION_ACTIVA);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Suscripcion activa');
  });

  it('un 403 de administracion explica el permiso, no habla de sesion', async () => {
    seleccionar();
    const fixture = TestBed.createComponent(SubscriptionPage);
    fixture.detectChanges();

    httpMock
      .expectOne(URL_SUSCRIPCION)
      .flush({ type: 'https://akine.app/problems/forbidden' }, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('no administra este centro');
  });

  it('un missing-tenant-context ofrece elegir contexto en vez de reintentar', async () => {
    seleccionar();
    const fixture = TestBed.createComponent(SubscriptionPage);
    fixture.detectChanges();

    httpMock.expectOne(URL_SUSCRIPCION).flush(
      { type: 'https://akine.app/problems/missing-tenant-context' },
      { status: 403, statusText: 'Forbidden' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).toBeTruthy();
  });

  it('un 404 no distingue inexistente de ajena', async () => {
    seleccionar();
    const fixture = TestBed.createComponent(SubscriptionPage);
    fixture.detectChanges();

    httpMock
      .expectOne(URL_SUSCRIPCION)
      .flush({ type: 'https://akine.app/problems/not-found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No encontramos esta organizacion');
  });

  it('ante otro error del servidor muestra el detail del backend', async () => {
    seleccionar();
    const fixture = TestBed.createComponent(SubscriptionPage);
    fixture.detectChanges();

    httpMock.expectOne(URL_SUSCRIPCION).flush(
      { type: 'https://akine.app/problems/internal-error', detail: 'Fallo al leer la suscripcion' },
      { status: 500, statusText: 'Internal Server Error' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Fallo al leer la suscripcion');
  });

  function seleccionar(): void {
    tenantContext.select({ organizationId: 1, organizationName: 'Centro Kinesico Belgrano' });
  }

  async function cargarCon(cuerpo: object) {
    const fixture = TestBed.createComponent(SubscriptionPage);
    fixture.detectChanges();
    httpMock.expectOne(URL_SUSCRIPCION).flush(cuerpo);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
});

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}
