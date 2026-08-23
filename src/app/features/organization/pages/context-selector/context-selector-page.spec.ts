import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  AccessTokenResponse,
  AccessTokenResponseScopeEnum,
} from '../../../../api/generated/model/access-token-response';
import { AuthorizedContextResponse } from '../../../../api/generated/model/authorized-context-response';
import { ContextSelectorPage } from './context-selector-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const URL_CONTEXTOS = '/api/v1/me/contexts';
const URL_CANJE = '/api/v1/auth/context';

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

/** Respuesta del canje: un access token ya acotado al par elegido. */
function tokenDeContexto(organizationId: number, consultorioId: number): AccessTokenResponse {
  return {
    accessToken: `jwt-${organizationId}-${consultorioId}`,
    scope: AccessTokenResponseScopeEnum.CONTEXT,
    organizationId,
    consultorioId,
    roleCode: 'OWNER',
  };
}

/**
 * Spec del selector de contexto (AKINE-01.01 / 01.02).
 *
 * <p>Lo que se cubre es la logica real: la auto-seleccion con un solo contexto, el canje del
 * token contra `POST /api/v1/auth/context` -sin el cual el `contextGuard` rebota la
 * navegacion y la pantalla siguiente nunca se abre- y los estados obligatorios de ADR-0005.
 * El backend se simula: el test no depende de que haya un servidor levantado.
 */
describe('ContextSelectorPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let router: Router;

  /**
   * Monta el TestBed con los query params que traeria la URL.
   *
   * <p>`ActivatedRoute` se sustituye por un doble porque el componente no se monta ruteado:
   * lo unico que necesita de la ruta es el `volverA` que le escribio el `contextGuard`.
   */
  async function montar(queryParams: Record<string, string> = {}): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ContextSelectorPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } },
        },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
    router = TestBed.inject(Router);
  }

  beforeEach(() => montar());

  afterEach(() => httpMock.verify());

  it('muestra el estado de carga antes de la respuesta', () => {
    const fixture = TestBed.createComponent(ContextSelectorPage);
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Buscando tus contextos');

    httpMock.expectOne(URL_CONTEXTOS).flush([]);
  });

  it('con un solo contexto lo auto-selecciona, canjea el token y no muestra el selector', async () => {
    const navegar = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const fixture = await pintar([CONTEXTO_BELGRANO]);

    // Elegir entre una sola opcion no es una decision: no se le pide al usuario.
    expect(fixture.nativeElement.querySelectorAll('.opcion').length).toBe(0);

    const canje = httpMock.expectOne(URL_CANJE);
    expect(canje.request.body).toEqual({ organizationId: 1, consultorioId: 1 });
    canje.flush(tokenDeContexto(1, 1));
    await estabilizar(fixture);

    expect(tenantContext.context()).toEqual({
      organizationId: 1,
      organizationName: 'Centro Kinesico Belgrano',
      consultorioId: 1,
      consultorioName: 'Sede Central',
    });
    expect(navegar).toHaveBeenCalledWith('/organizacion');
  });

  it('con un solo contexto si dice que no hacia falta elegir', async () => {
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const fixture = await pintar([CONTEXTO_BELGRANO]);

    expect(texto(fixture)).toContain('Centro Kinesico Belgrano');
    expect(texto(fixture)).toContain('Tenes un solo contexto habilitado');

    httpMock.expectOne(URL_CANJE).flush(tokenDeContexto(1, 1));
  });

  it('con varios contextos los lista por nombre y no selecciona nada solo', async () => {
    const fixture = await pintar([CONTEXTO_BELGRANO, CONTEXTO_CABALLITO]);

    const opciones = fixture.nativeElement.querySelectorAll('.opcion');
    expect(opciones.length).toBe(2);
    // Se muestran nombres, no ids tecnicos.
    expect(texto(fixture)).toContain('Centro Kinesico Caballito');
    expect(tenantContext.context()).toBeNull();
  });

  it('elegir una opcion canjea el token, fija el contexto y navega', async () => {
    const navegar = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const fixture = await pintar([CONTEXTO_BELGRANO, CONTEXTO_CABALLITO]);
    const epochPrevio = tenantContext.contextEpoch();

    fixture.nativeElement.querySelectorAll('.opcion')[1].click();
    await estabilizar(fixture);

    // Sin este POST el token queda en `pre_context` y el contextGuard rebota la navegacion.
    const canje = httpMock.expectOne(URL_CANJE);
    expect(canje.request.body).toEqual({ organizationId: 2, consultorioId: 7 });

    // Mientras el canje esta en vuelo el contexto todavia no se dio por elegido.
    expect(tenantContext.contextEpoch()).toBe(epochPrevio);
    expect(navegar).not.toHaveBeenCalled();

    canje.flush(tokenDeContexto(2, 7));
    await estabilizar(fixture);

    expect(tenantContext.organizationId()).toBe(2);
    // El epoch avanza: las features que cachean datos deben descartar su estado.
    expect(tenantContext.contextEpoch()).toBe(epochPrevio + 1);
    expect(navegar).toHaveBeenCalledWith('/organizacion');
  });

  it('mientras el canje esta en curso no afirma que hay un solo contexto', async () => {
    const fixture = await pintar([CONTEXTO_BELGRANO, CONTEXTO_CABALLITO]);

    fixture.nativeElement.querySelectorAll('.opcion')[0].click();
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Entrando a Centro Kinesico Belgrano');
    expect(texto(fixture)).not.toContain('Tenes un solo contexto habilitado');

    httpMock.expectOne(URL_CANJE).flush(tokenDeContexto(1, 1));
  });

  it('un clic no puede disparar dos canjes: la lista desaparece mientras entra', async () => {
    const fixture = await pintar([CONTEXTO_BELGRANO, CONTEXTO_CABALLITO]);

    fixture.nativeElement.querySelectorAll('.opcion')[0].click();
    await estabilizar(fixture);

    expect(fixture.nativeElement.querySelectorAll('.opcion').length).toBe(0);

    httpMock.expectOne(URL_CANJE).flush(tokenDeContexto(1, 1));
  });

  it('sin contextos distingue el vacio del error y no lo trata como fallo', async () => {
    const fixture = await pintar([]);

    expect(texto(fixture)).toContain('No tenes organizaciones asignadas');
    expect(texto(fixture)).toContain('Contacta a tu administrador');
    // Vacio no es error: no se anuncia como alerta.
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('descarta los contextos sin organizacion, que no son elegibles', async () => {
    const fixture = await pintar([{ consultorioName: 'Huerfano' }]);

    expect(texto(fixture)).toContain('No tenes organizaciones asignadas');
  });

  it('descarta los contextos sin consultorio: el canje exige los dos ids', async () => {
    const fixture = await pintar([{ organizationId: 3, organizationName: 'Centro Sin Sede' }]);

    expect(texto(fixture)).toContain('No tenes organizaciones asignadas');
  });

  // --- Destino ---------------------------------------------------------------------

  it('vuelve a donde el guard queria llevar al usuario', async () => {
    TestBed.resetTestingModule();
    await montar({ volverA: '/organizacion/suscripcion' });
    const navegar = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const fixture = await pintar([CONTEXTO_BELGRANO]);
    httpMock.expectOne(URL_CANJE).flush(tokenDeContexto(1, 1));
    await estabilizar(fixture);

    expect(navegar).toHaveBeenCalledWith('/organizacion/suscripcion');
  });

  it('ignora un destino externo: la pantalla no sirve de redireccion abierta', async () => {
    TestBed.resetTestingModule();
    await montar({ volverA: 'https://phishing.example/akine' });
    const navegar = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const fixture = await pintar([CONTEXTO_BELGRANO]);
    httpMock.expectOne(URL_CANJE).flush(tokenDeContexto(1, 1));
    await estabilizar(fixture);

    expect(navegar).toHaveBeenCalledWith('/organizacion');
  });

  it('ignora un destino que apunta a esta misma pantalla, que seria un rebote infinito', async () => {
    TestBed.resetTestingModule();
    await montar({ volverA: '/seleccionar-contexto' });
    const navegar = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const fixture = await pintar([CONTEXTO_BELGRANO]);
    httpMock.expectOne(URL_CANJE).flush(tokenDeContexto(1, 1));
    await estabilizar(fixture);

    expect(navegar).toHaveBeenCalledWith('/organizacion');
  });

  it('si la navegacion falla lo dice, en vez de dejar el "Entrando a..." para siempre', async () => {
    vi.spyOn(router, 'navigateByUrl').mockRejectedValue(new Error('ruta rota'));
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const fixture = await pintar([CONTEXTO_BELGRANO]);
    httpMock.expectOne(URL_CANJE).flush(tokenDeContexto(1, 1));
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('El contexto quedo elegido pero no pudimos abrir');
    expect(consola).toHaveBeenCalled();
  });

  // --- Fallos del canje ------------------------------------------------------------

  it('un 404 al elegir vuelve al selector con la lista recargada y explica por que', async () => {
    const fixture = await pintar([CONTEXTO_BELGRANO, CONTEXTO_CABALLITO]);

    fixture.nativeElement.querySelectorAll('.opcion')[1].click();
    await estabilizar(fixture);

    httpMock
      .expectOne(URL_CANJE)
      .flush(
        { type: 'https://akine.app/problems/not-found', detail: 'Contexto no encontrado' },
        { status: 404, statusText: 'Not Found' },
      );
    await estabilizar(fixture);

    // La lista vieja quedo obsoleta: se vuelve a pedir, no se reusa.
    httpMock.expectOne(URL_CONTEXTOS).flush([CONTEXTO_BELGRANO, CONTEXTO_CABALLITO]);
    await estabilizar(fixture);

    // El aviso sobrevive a la recarga: si no, el usuario ve la lista parpadear sin motivo.
    expect(texto(fixture)).toContain('Ese contexto ya no esta disponible');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('.opcion').length).toBe(2);
    expect(tenantContext.context()).toBeNull();
  });

  it('un 404 sobre el unico contexto no recarga en bucle: corta con un error y reintento', async () => {
    const fixture = await pintar([CONTEXTO_BELGRANO]);

    httpMock
      .expectOne(URL_CANJE)
      .flush(
        { type: 'https://akine.app/problems/not-found', detail: 'Contexto no encontrado' },
        { status: 404, statusText: 'Not Found' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Ese contexto ya no esta disponible');
    // Lo que prueba que no hay bucle: nadie volvio a pedir la lista solo.
    httpMock.expectNone(URL_CONTEXTOS);
    expect(fixture.nativeElement.querySelector('button')).toBeTruthy();
  });

  it('un fallo de red al canjear se muestra como fallo de red, no como contexto invalido', async () => {
    const fixture = await pintar([CONTEXTO_BELGRANO, CONTEXTO_CABALLITO]);

    fixture.nativeElement.querySelectorAll('.opcion')[0].click();
    await estabilizar(fixture);

    httpMock
      .expectOne(URL_CANJE)
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No se pudo contactar al servidor');
    expect(texto(fixture)).not.toContain('ya no esta disponible');
  });

  it('un 500 al canjear muestra el mensaje del backend, no uno generico nuestro', async () => {
    const fixture = await pintar([CONTEXTO_BELGRANO, CONTEXTO_CABALLITO]);

    fixture.nativeElement.querySelectorAll('.opcion')[0].click();
    await estabilizar(fixture);

    httpMock
      .expectOne(URL_CANJE)
      .flush(
        { type: 'https://akine.app/problems/internal-error', detail: 'Fallo al emitir el token' },
        { status: 500, statusText: 'Internal Server Error' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Fallo al emitir el token');
  });

  // --- Fallos del listado ----------------------------------------------------------

  it('ante un fallo de red muestra una alerta con reintento, y el reintento vuelve a pedir', async () => {
    const fixture = TestBed.createComponent(ContextSelectorPage);
    fixture.detectChanges();
    httpMock
      .expectOne(URL_CONTEXTOS)
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No se pudo contactar al servidor');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();

    fixture.nativeElement.querySelector('button')?.click();
    fixture.detectChanges();

    httpMock.expectOne(URL_CONTEXTOS).flush([]);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No tenes organizaciones asignadas');
  });

  it('un 403 dice que la sesion no esta activa, no que el servidor fallo', async () => {
    const fixture = TestBed.createComponent(ContextSelectorPage);
    fixture.detectChanges();
    httpMock
      .expectOne(URL_CONTEXTOS)
      .flush(
        { type: 'https://akine.app/problems/forbidden', detail: 'Sin autenticacion' },
        { status: 403, statusText: 'Forbidden' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Volve a iniciar sesion');
  });

  it('ante un 500 muestra el mensaje del backend, no uno generico nuestro', async () => {
    const fixture = TestBed.createComponent(ContextSelectorPage);
    fixture.detectChanges();
    httpMock.expectOne(URL_CONTEXTOS).flush(
      {
        type: 'https://akine.app/problems/internal-error',
        detail: 'Fallo al resolver contextos',
      },
      { status: 500, statusText: 'Internal Server Error' },
    );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Fallo al resolver contextos');
    expect(fixture.nativeElement.querySelector('button')).toBeTruthy();
  });

  // --- Accesibilidad ---------------------------------------------------------------

  it(
    'no tiene violaciones de axe con la lista de contextos',
    async () => {
      const fixture = await pintar([CONTEXTO_BELGRANO, CONTEXTO_CABALLITO]);

      // Cada opcion es un `button` con dos `span` adentro: el nombre accesible sale del
      // contenido, y una sola de las dos lineas ausente lo dejaria sin nombre util.
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it(
    'no tiene violaciones de axe con la lista vacia',
    async () => {
      const fixture = await pintar([]);

      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );
});

/** Crea la pantalla y le responde el listado de contextos. */
async function pintar(
  contextos: readonly AuthorizedContextResponse[],
): Promise<ComponentFixture<ContextSelectorPage>> {
  const fixture = TestBed.createComponent(ContextSelectorPage);
  fixture.detectChanges();
  TestBed.inject(HttpTestingController).expectOne(URL_CONTEXTOS).flush(contextos);
  await estabilizar(fixture);
  return fixture;
}

/** Deja que se asienten las microtareas y repinta: zoneless, nada lo hace solo. */
async function estabilizar(fixture: ComponentFixture<ContextSelectorPage>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}
