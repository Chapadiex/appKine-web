import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { ContextSelectorPage } from './context-selector-page';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const URL_CONTEXTOS = '/api/v1/me/contexts';

const CONTEXTO_BELGRANO = {
  organizationId: 1,
  organizationName: 'Centro Kinesico Belgrano',
  consultorioId: 1,
  consultorioName: 'Sede Central',
};

const CONTEXTO_CABALLITO = {
  organizationId: 2,
  organizationName: 'Centro Kinesico Caballito',
  consultorioId: 7,
  consultorioName: 'Sede Norte',
};

/**
 * Spec del selector de contexto (AKINE-01.01).
 *
 * <p>Lo que se cubre es la logica real: la auto-seleccion con un solo contexto -que es la
 * unica decision no trivial de la pantalla- y los estados obligatorios de ADR-0005. El
 * backend se simula: el test no depende de que haya un servidor levantado, ni de un login
 * que todavia no existe.
 */
describe('ContextSelectorPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContextSelectorPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
    router = TestBed.inject(Router);
  });

  afterEach(() => httpMock.verify());

  it('muestra el estado de carga antes de la respuesta', () => {
    const fixture = TestBed.createComponent(ContextSelectorPage);
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Buscando tus contextos');

    httpMock.expectOne(URL_CONTEXTOS).flush([]);
  });

  it('con un solo contexto lo auto-selecciona y no muestra el selector', async () => {
    const navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(ContextSelectorPage);
    fixture.detectChanges();
    httpMock.expectOne(URL_CONTEXTOS).flush([CONTEXTO_BELGRANO]);
    await fixture.whenStable();
    fixture.detectChanges();

    // Elegir entre una sola opcion no es una decision: no se le pide al usuario.
    expect(fixture.nativeElement.querySelectorAll('.opcion').length).toBe(0);
    expect(tenantContext.context()).toEqual({
      organizationId: 1,
      organizationName: 'Centro Kinesico Belgrano',
      consultorioId: 1,
      consultorioName: 'Sede Central',
    });
    expect(navegar).toHaveBeenCalledWith(['/organizacion']);
    expect(texto(fixture)).toContain('Centro Kinesico Belgrano');
  });

  it('con varios contextos los lista por nombre y no selecciona nada solo', async () => {
    const fixture = TestBed.createComponent(ContextSelectorPage);
    fixture.detectChanges();
    httpMock.expectOne(URL_CONTEXTOS).flush([CONTEXTO_BELGRANO, CONTEXTO_CABALLITO]);
    await fixture.whenStable();
    fixture.detectChanges();

    const opciones = fixture.nativeElement.querySelectorAll('.opcion');
    expect(opciones.length).toBe(2);
    // Se muestran nombres, no ids tecnicos.
    expect(texto(fixture)).toContain('Centro Kinesico Caballito');
    expect(tenantContext.context()).toBeNull();
  });

  it('elegir una opcion fija el contexto y navega', async () => {
    const navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(ContextSelectorPage);
    fixture.detectChanges();
    httpMock.expectOne(URL_CONTEXTOS).flush([CONTEXTO_BELGRANO, CONTEXTO_CABALLITO]);
    await fixture.whenStable();
    fixture.detectChanges();

    const epochPrevio = tenantContext.contextEpoch();
    fixture.nativeElement.querySelectorAll('.opcion')[1].click();
    fixture.detectChanges();

    expect(tenantContext.organizationId()).toBe(2);
    // El epoch avanza: las features que cachean datos deben descartar su estado.
    expect(tenantContext.contextEpoch()).toBe(epochPrevio + 1);
    expect(navegar).toHaveBeenCalledWith(['/organizacion']);
  });

  it('sin contextos distingue el vacio del error y no lo trata como fallo', async () => {
    const fixture = TestBed.createComponent(ContextSelectorPage);
    fixture.detectChanges();
    httpMock.expectOne(URL_CONTEXTOS).flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No tenes organizaciones asignadas');
    expect(texto(fixture)).toContain('Contacta a tu administrador');
    // Vacio no es error: no se anuncia como alerta.
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('descarta los contextos sin organizacion, que no son elegibles', async () => {
    const fixture = TestBed.createComponent(ContextSelectorPage);
    fixture.detectChanges();
    httpMock.expectOne(URL_CONTEXTOS).flush([{ consultorioName: 'Huerfano' }]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No tenes organizaciones asignadas');
  });

  it('ante un fallo de red muestra una alerta con reintento, y el reintento vuelve a pedir', async () => {
    const fixture = TestBed.createComponent(ContextSelectorPage);
    fixture.detectChanges();
    httpMock
      .expectOne(URL_CONTEXTOS)
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No se pudo contactar al servidor');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();

    fixture.nativeElement.querySelector('button')?.click();
    fixture.detectChanges();

    httpMock.expectOne(URL_CONTEXTOS).flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No tenes organizaciones asignadas');
  });

  it('un 403 dice que la sesion no esta activa, no que el servidor fallo', async () => {
    const fixture = TestBed.createComponent(ContextSelectorPage);
    fixture.detectChanges();
    httpMock.expectOne(URL_CONTEXTOS).flush(
      { type: 'https://akine.app/problems/forbidden', detail: 'Sin autenticacion' },
      { status: 403, statusText: 'Forbidden' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Volve a iniciar sesion');
  });

  it('ante un 500 muestra el mensaje del backend, no uno generico nuestro', async () => {
    const fixture = TestBed.createComponent(ContextSelectorPage);
    fixture.detectChanges();
    httpMock.expectOne(URL_CONTEXTOS).flush(
      { type: 'https://akine.app/problems/internal-error', detail: 'Fallo al resolver contextos' },
      { status: 500, statusText: 'Internal Server Error' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Fallo al resolver contextos');
    expect(fixture.nativeElement.querySelector('button')).toBeTruthy();
  });
});

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}
