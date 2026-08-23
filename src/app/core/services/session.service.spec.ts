import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { SessionService } from './session.service';
import { AuthTokenStore } from './auth-token.store';
import { TenantContextStore } from './tenant-context.store';
import { provideApi } from '../../api/generated/provide-api';

/**
 * Verifica el ciclo de vida de la sesion (AKINE-01.02, DP-02).
 *
 * <p>Lo que se prueba no es "que ande el happy path": son las cuatro trampas concretas de
 * este flujo -el token pre_context que no habilita negocio, el single-flight del refresh,
 * el arranque sin cookie y el aislamiento de tenant al cambiar de contexto-.
 */
describe('SessionService', () => {
  let session: SessionService;
  let httpMock: HttpTestingController;
  let tokenStore: AuthTokenStore;
  let tenantStore: TenantContextStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi('')],
    });

    session = TestBed.inject(SessionService);
    httpMock = TestBed.inject(HttpTestingController);
    tokenStore = TestBed.inject(AuthTokenStore);
    tenantStore = TestBed.inject(TenantContextStore);
  });

  afterEach(() => httpMock.verify());

  // --- Login -----------------------------------------------------------------------

  it('el login deja la sesion autenticada pero SIN contexto', async () => {
    const terminado = primerValor(session.login('kine@akine.test', 'clave-sintetica'));

    const peticion = httpMock.expectOne('/api/v1/auth/login');
    expect(peticion.request.body).toEqual({
      email: 'kine@akine.test',
      password: 'clave-sintetica',
    });
    peticion.flush({ accessToken: 'jwt-pre', scope: 'pre_context', expiresIn: 600 });

    await terminado;
    // Con pre_context ningun endpoint de negocio responde: el backend corta con
    // 403 missing-tenant-context. Por eso no puede decir 'activa'.
    expect(session.estado()).toBe('sin-contexto');
    expect(tokenStore.token()).toBe('jwt-pre');
  });

  it('propaga el rechazo del login sin inventar detalle', async () => {
    const fallo = primerError(session.login('kine@akine.test', 'mala'));

    httpMock
      .expectOne('/api/v1/auth/login')
      .flush(
        { type: 'https://akine.app/problems/invalid-credentials' },
        { status: 401, statusText: 'Unauthorized' },
      );

    await fallo;
    expect(session.estado()).toBe('anonimo');
  });

  it('un 200 sin accessToken se trata como contrato roto, no como sesion valida', async () => {
    const fallo = primerError(session.login('kine@akine.test', 'clave'));

    httpMock.expectOne('/api/v1/auth/login').flush({ scope: 'pre_context' });

    await fallo;
    expect(session.estado()).toBe('anonimo');
  });

  // --- Contextos -------------------------------------------------------------------

  it('carga los contextos autorizados', async () => {
    const contextos = [
      {
        organizationId: 1,
        organizationName: 'Centro Norte',
        consultorioId: 10,
        consultorioName: 'Sede Central',
      },
    ];
    const terminado = primerValor(session.cargarContextos());

    httpMock.expectOne('/api/v1/me/contexts').flush(contextos);

    await terminado;
    expect(session.contextos()).toEqual(contextos);
  });

  it('una lista vacia de contextos no es un error', async () => {
    const terminado = primerValor(session.cargarContextos());
    httpMock.expectOne('/api/v1/me/contexts').flush([]);

    await terminado;
    expect(session.contextos()).toEqual([]);
    expect(session.contextoActivo()).toBeNull();
  });

  it('elegir contexto activa la sesion y publica el tenant con sus nombres', async () => {
    await cargarContextosDePrueba();

    const terminado = primerValor(session.seleccionarContexto(1, 10));

    const peticion = httpMock.expectOne('/api/v1/auth/context');
    expect(peticion.request.body).toEqual({ organizationId: 1, consultorioId: 10 });
    peticion.flush({
      accessToken: 'jwt-ctx',
      scope: 'context',
      organizationId: 1,
      consultorioId: 10,
      roleCode: 'OWNER',
    });

    await terminado;
    expect(session.estado()).toBe('activa');
    expect(session.contextoActivo()?.organizationName).toBe('Centro Norte');
    expect(tenantStore.context()?.consultorioName).toBe('Sede Central');
  });

  it('cambiar de contexto invalida el estado de las features', async () => {
    await cargarContextosDePrueba();
    await elegirContexto(1, 10, 'jwt-a');
    const epochInicial = tenantStore.contextEpoch();

    await elegirContexto(2, 20, 'jwt-b');

    // Los servicios de feature descartan su cache al ver cambiar contextEpoch. Sin eso los
    // datos de la Organizacion A quedan en pantalla bajo la Organizacion B: es el bug de
    // aislamiento mas grave del frontend porque expone datos clinicos ajenos.
    expect(tenantStore.contextEpoch()).toBeGreaterThan(epochInicial);
    expect(tenantStore.organizationId()).toBe(2);
    expect(session.contextoActivo()?.organizationName).toBe('Centro Sur');
    expect(tokenStore.token()).toBe('jwt-b');
  });

  it('un 404 al elegir contexto deja la sesion sin contexto, no anonima', async () => {
    await cargarContextosDePrueba();

    const fallo = primerError(session.seleccionarContexto(1, 99));
    httpMock
      .expectOne('/api/v1/auth/context')
      .flush({ type: 'https://akine.app/problems/not-found' }, { status: 404, statusText: 'x' });

    await fallo;
    // La salida es volver al selector: el token pre_context sigue siendo valido.
    expect(session.estado()).toBe('anonimo');
  });

  // --- Refresh single-flight -------------------------------------------------------

  it('SINGLE-FLIGHT: dos refrescos concurrentes disparan UNA sola peticion', async () => {
    const primero = primerValor(session.refrescar());
    const segundo = primerValor(session.refrescar());

    // Si saliera mas de una, `expectOne` falla. Es exactamente lo que hay que impedir: el
    // backend detecta el segundo canje como reuso y revoca la familia de sesion entera.
    const peticion = httpMock.expectOne('/api/v1/auth/refresh');
    peticion.flush({ accessToken: 'jwt-nuevo', scope: 'pre_context' });

    await primero;
    await segundo;
    expect(tokenStore.token()).toBe('jwt-nuevo');
    httpMock.verify();
  });

  it('SINGLE-FLIGHT: el que llega tarde a un refresh en vuelo recibe el mismo resultado', async () => {
    const primero = primerValor(session.refrescar());
    const tarde = primerValor(session.refrescar());

    httpMock.expectOne('/api/v1/auth/refresh').flush({ accessToken: 'jwt-x', scope: 'context' });

    await primero;
    await tarde;
    expect(tokenStore.token()).toBe('jwt-x');
  });

  it('SINGLE-FLIGHT: terminado un ciclo, el proximo refresh vuelve a salir', async () => {
    const primero = primerValor(session.refrescar());
    httpMock
      .expectOne('/api/v1/auth/refresh')
      .flush({ accessToken: 'jwt-1', scope: 'pre_context' });
    await primero;

    const segundo = primerValor(session.refrescar());
    httpMock
      .expectOne('/api/v1/auth/refresh')
      .flush({ accessToken: 'jwt-2', scope: 'pre_context' });
    await segundo;

    expect(tokenStore.token()).toBe('jwt-2');
  });

  it('SINGLE-FLIGHT: un refresh fallido libera el hueco para el siguiente', async () => {
    const fallo = primerError(session.refrescar());
    httpMock
      .expectOne('/api/v1/auth/refresh')
      .flush(
        { type: 'https://akine.app/problems/invalid-refresh' },
        { status: 401, statusText: 'x' },
      );
    await fallo;

    const segundo = primerValor(session.refrescar());
    httpMock
      .expectOne('/api/v1/auth/refresh')
      .flush({ accessToken: 'jwt-ok', scope: 'pre_context' });
    await segundo;

    expect(tokenStore.token()).toBe('jwt-ok');
  });

  it('el refresh puede DEGRADAR a pre_context y ahi se suelta el contexto viejo', async () => {
    await cargarContextosDePrueba();
    await elegirContexto(1, 10, 'jwt-ctx');

    const terminado = primerValor(session.refrescar());
    httpMock
      .expectOne('/api/v1/auth/refresh')
      .flush({ accessToken: 'jwt-degradado', scope: 'pre_context' });
    await terminado;

    // La membership dejo de ser accesible. Quedarse con el contexto viejo dibujaria una
    // organizacion sobre la que ya no se puede operar.
    expect(session.estado()).toBe('sin-contexto');
    expect(session.contextoActivo()).toBeNull();
    expect(tenantStore.context()).toBeNull();
  });

  // --- Restaurar sesion ------------------------------------------------------------

  it('restaurarSesion SIN cookie devuelve false y no explota', async () => {
    const resultado = primerValor(session.restaurarSesion());

    httpMock
      .expectOne('/api/v1/auth/refresh')
      .flush(
        { type: 'https://akine.app/problems/invalid-refresh' },
        { status: 401, statusText: 'Unauthorized' },
      );

    // Es el caso normal de un visitante que nunca se logueo: no es un error y no debe
    // llenar la consola de ruido.
    expect(await resultado).toBe(false);
    expect(session.estado()).toBe('anonimo');
  });

  it('restaurarSesion con cookie viva devuelve true', async () => {
    const resultado = primerValor(session.restaurarSesion());

    httpMock
      .expectOne('/api/v1/auth/refresh')
      .flush({ accessToken: 'jwt-restaurado', scope: 'pre_context' });

    expect(await resultado).toBe(true);
    expect(session.estado()).toBe('sin-contexto');
  });

  it('restaurarSesion rehidrata los nombres del contexto que el token trajo como ids', async () => {
    const resultado = primerValor(session.restaurarSesion());

    httpMock.expectOne('/api/v1/auth/refresh').flush({
      accessToken: 'jwt-ctx',
      scope: 'context',
      organizationId: 1,
      consultorioId: 10,
    });

    // El token trae ids, no nombres, y la barra superior necesita decir donde esta parado
    // el usuario.
    httpMock.expectOne('/api/v1/me/contexts').flush([
      {
        organizationId: 1,
        organizationName: 'Centro Norte',
        consultorioId: 10,
        consultorioName: 'Sede Central',
      },
    ]);

    expect(await resultado).toBe(true);
    expect(session.estado()).toBe('activa');
    expect(session.contextoActivo()?.organizationName).toBe('Centro Norte');
  });

  it('que falle el listado de nombres no invalida una sesion que el backend acepto', async () => {
    const resultado = primerValor(session.restaurarSesion());

    httpMock.expectOne('/api/v1/auth/refresh').flush({
      accessToken: 'jwt-ctx',
      scope: 'context',
      organizationId: 7,
      consultorioId: 70,
    });
    httpMock
      .expectOne('/api/v1/me/contexts')
      .flush(null, { status: 500, statusText: 'Internal Server Error' });

    expect(await resultado).toBe(true);
    expect(session.estado()).toBe('activa');
    expect(session.contextoActivo()?.organizationId).toBe(7);
  });

  // --- Cierre ----------------------------------------------------------------------

  it('el logout limpia todo el estado local', async () => {
    await cargarContextosDePrueba();
    await elegirContexto(1, 10, 'jwt-ctx');

    const terminado = primerValor(session.logout());
    httpMock
      .expectOne('/api/v1/auth/logout')
      .flush(null, { status: 204, statusText: 'No Content' });
    await terminado;

    expect(session.estado()).toBe('anonimo');
    expect(session.contextoActivo()).toBeNull();
    expect(tenantStore.context()).toBeNull();
  });

  it('el logout limpia el estado local aunque la llamada falle', async () => {
    tokenStore.set('jwt-huerfano');

    const terminado = primerValor(session.logout());
    httpMock
      .expectOne('/api/v1/auth/logout')
      .flush(null, { status: 500, statusText: 'Internal Server Error' });
    await terminado;

    // Un logout que no desloguea es la unica falla inaceptable de esta operacion.
    expect(session.estado()).toBe('anonimo');
  });

  it('cerrarTodasLasSesiones devuelve cuantas cerro y limpia el estado', async () => {
    tokenStore.set('jwt-ctx');

    const resultado = primerValor(session.cerrarTodasLasSesiones());
    httpMock.expectOne('/api/v1/auth/sessions').flush({ closedSessions: 3 });

    expect(await resultado).toBe(3);
    expect(session.estado()).toBe('anonimo');
  });

  it('cerrarTodasLasSesiones sin cuerpo util devuelve cero', async () => {
    const resultado = primerValor(session.cerrarTodasLasSesiones());
    httpMock.expectOne('/api/v1/auth/sessions').flush({});

    expect(await resultado).toBe(0);
  });

  // --- Ayudas ----------------------------------------------------------------------

  async function cargarContextosDePrueba(): Promise<void> {
    const terminado = primerValor(session.cargarContextos());
    httpMock.expectOne('/api/v1/me/contexts').flush([
      {
        organizationId: 1,
        organizationName: 'Centro Norte',
        consultorioId: 10,
        consultorioName: 'Sede Central',
      },
      {
        organizationId: 2,
        organizationName: 'Centro Sur',
        consultorioId: 20,
        consultorioName: 'Anexo',
      },
    ]);
    await terminado;
  }

  async function elegirContexto(
    organizationId: number,
    consultorioId: number,
    token: string,
  ): Promise<void> {
    const terminado = primerValor(session.seleccionarContexto(organizationId, consultorioId));
    httpMock.expectOne('/api/v1/auth/context').flush({
      accessToken: token,
      scope: 'context',
      organizationId,
      consultorioId,
    });
    await terminado;
  }
});

/** Resuelve con el primer valor del observable. Falla si el observable falla. */
function primerValor<T>(observable: {
  subscribe: (o: { next: (v: T) => void; error: (e: unknown) => void }) => void;
}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    observable.subscribe({ next: resolve, error: reject });
  });
}

/** Resuelve con el error del observable. Falla si el observable tiene exito. */
function primerError(observable: {
  subscribe: (o: { next: () => void; error: (e: unknown) => void }) => void;
}): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    observable.subscribe({
      next: () => reject(new Error('se esperaba un error y la operacion tuvo exito')),
      error: resolve,
    });
  });
}
