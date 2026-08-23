import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { Router, provideRouter } from '@angular/router';

import { authInterceptor } from './auth.interceptor';
import { errorInterceptor } from './error.interceptor';
import { AuthTokenStore } from '../services/auth-token.store';
import { SessionService } from '../services/session.service';
import { provideApi } from '../../api/generated/provide-api';

/**
 * Verifica el interceptor de autenticacion (ADR-0001).
 *
 * <p>Las dos garantias que se prueban son de seguridad, no de comodidad: que el token
 * <b>solo</b> viaje a la API propia, y que las credenciales se envien para que la cookie
 * httpOnly del refresh llegue al backend.
 */
describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let tokenStore: AuthTokenStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        // Los dos juntos y en este orden, igual que en app.config.ts: `authInterceptor` es
        // el externo, asi que los errores que le llegan ya vienen traducidos a
        // AkineHttpError. Probarlo solo escondaria esa interaccion.
        provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
        provideHttpClientTesting(),
        provideApi(''),
        provideRouter([]),
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    tokenStore = TestBed.inject(AuthTokenStore);
  });

  afterEach(() => httpMock.verify());

  it('adjunta el token a las peticiones de la API', () => {
    tokenStore.set('jwt-de-prueba');

    http.get('/api/v1/pacientes').subscribe();

    const peticion = httpMock.expectOne('/api/v1/pacientes');
    expect(peticion.request.headers.get('Authorization')).toBe('Bearer jwt-de-prueba');
    peticion.flush({});
  });

  it('envia credenciales para que viaje la cookie httpOnly del refresh', () => {
    tokenStore.set('jwt-de-prueba');

    http.get('/api/v1/pacientes').subscribe();

    const peticion = httpMock.expectOne('/api/v1/pacientes');
    expect(peticion.request.withCredentials).toBe(true);
    peticion.flush({});
  });

  it('sin sesion, no agrega cabecera Authorization', () => {
    http.get('/api/v1/version').subscribe();

    const peticion = httpMock.expectOne('/api/v1/version');
    expect(peticion.request.headers.has('Authorization')).toBe(false);
    peticion.flush({});
  });

  it('NO manda el token a un host de terceros', () => {
    tokenStore.set('jwt-de-prueba');

    http.get('https://un-tercero.example.com/datos').subscribe();

    const peticion = httpMock.expectOne('https://un-tercero.example.com/datos');
    // Mandar el token fuera de la API propia seria filtrarlo.
    expect(peticion.request.headers.has('Authorization')).toBe(false);
    expect(peticion.request.withCredentials).toBe(false);
    peticion.flush({});
  });

  it('NO manda el token a un recurso estatico de la propia app', () => {
    tokenStore.set('jwt-de-prueba');

    http.get('/assets/config.json').subscribe();

    const peticion = httpMock.expectOne('/assets/config.json');
    expect(peticion.request.headers.has('Authorization')).toBe(false);
    peticion.flush({});
  });

  // --- Renovacion automatica -------------------------------------------------------

  it('ante un 401 renueva la sesion y reintenta con el token nuevo', async () => {
    tokenStore.set('jwt-vencido');
    const resultado = new Promise((resolve) => http.get('/api/v1/pacientes').subscribe(resolve));

    httpMock
      .expectOne('/api/v1/pacientes')
      .flush(
        { type: 'https://akine.app/problems/invalid-token' },
        { status: 401, statusText: 'x' },
      );

    httpMock
      .expectOne('/api/v1/auth/refresh')
      .flush({ accessToken: 'jwt-nuevo', scope: 'context', organizationId: 1, consultorioId: 10 });

    const reintento = httpMock.expectOne('/api/v1/pacientes');
    expect(reintento.request.headers.get('Authorization')).toBe('Bearer jwt-nuevo');
    reintento.flush([{ id: 1 }]);

    expect(await resultado).toEqual([{ id: 1 }]);
    expect(tokenStore.token()).toBe('jwt-nuevo');
  });

  it('COLA SINGLE-FLIGHT: dos 401 concurrentes disparan UN SOLO refresh', async () => {
    tokenStore.set('jwt-vencido');

    const uno = new Promise((resolve) => http.get('/api/v1/pacientes').subscribe(resolve));
    const dos = new Promise((resolve) => http.get('/api/v1/turnos').subscribe(resolve));

    httpMock.expectOne('/api/v1/pacientes').flush(null, { status: 401, statusText: 'x' });
    httpMock.expectOne('/api/v1/turnos').flush(null, { status: 401, statusText: 'x' });

    // `expectOne` es la prueba: si hubiera salido un segundo refresh, falla aca. Ese
    // segundo canje el backend lo lee como REUSO y revoca la familia de sesion completa
    // -victima y atacante afuera-, que es exactamente el bug que esta cola evita.
    httpMock
      .expectOne('/api/v1/auth/refresh')
      .flush({ accessToken: 'jwt-nuevo', scope: 'context' });

    const rPacientes = httpMock.expectOne('/api/v1/pacientes');
    const rTurnos = httpMock.expectOne('/api/v1/turnos');
    expect(rPacientes.request.headers.get('Authorization')).toBe('Bearer jwt-nuevo');
    expect(rTurnos.request.headers.get('Authorization')).toBe('Bearer jwt-nuevo');
    rPacientes.flush(['pacientes']);
    rTurnos.flush(['turnos']);

    expect(await uno).toEqual(['pacientes']);
    expect(await dos).toEqual(['turnos']);

    // Y no quedo ninguna peticion suelta: exactamente 1 refresh en todo el episodio.
    httpMock.verify();
  });

  it('si el refresh falla, limpia el estado y propaga el error ORIGINAL', async () => {
    tokenStore.set('jwt-vencido');
    const session = TestBed.inject(SessionService);

    const fallo = new Promise<unknown>((resolve) =>
      http.get('/api/v1/pacientes').subscribe({ error: resolve }),
    );

    httpMock
      .expectOne('/api/v1/pacientes')
      .flush(
        { type: 'https://akine.app/problems/invalid-token', detail: 'Token vencido' },
        { status: 401, statusText: 'Unauthorized' },
      );
    httpMock
      .expectOne('/api/v1/auth/refresh')
      .flush(
        { type: 'https://akine.app/problems/invalid-refresh' },
        { status: 401, statusText: 'x' },
      );

    const error = (await fallo) as { message: string };
    // La pantalla pidio pacientes, no un refresh: lo que tiene que ver es el error de su
    // propia peticion.
    expect(error.message).toBe('Token vencido');
    expect(tokenStore.token()).toBeNull();
    expect(session.estado()).toBe('anonimo');
  });

  it('si el refresh falla con sesion previa manda a sesion expirada, conservando el destino', async () => {
    const router = TestBed.inject(Router);
    const navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    // La pantalla en la que estaba parado el usuario cuando se le cayo la sesion.
    Object.defineProperty(router, 'url', {
      get: () => '/organizacion/suscripcion',
      configurable: true,
    });

    // Sesion viva: el usuario estaba trabajando cuando el token vencio.
    tokenStore.set('jwt-vencido');

    const fallo = new Promise<unknown>((resolve) =>
      http.get('/api/v1/pacientes').subscribe({ error: resolve }),
    );

    httpMock.expectOne('/api/v1/pacientes').flush(null, { status: 401, statusText: 'x' });
    httpMock
      .expectOne('/api/v1/auth/refresh')
      .flush(
        { type: 'https://akine.app/problems/invalid-refresh' },
        { status: 401, statusText: 'x' },
      );

    await fallo;
    // "Iniciá sesión" y "se te cayó la sesión a mitad de lo que estabas haciendo" no son el
    // mismo mensaje, y el segundo tiene que poder devolver al usuario a donde estaba.
    expect(navegar).toHaveBeenCalledWith(['/auth/sesion-expirada'], {
      queryParams: { volverA: '/organizacion/suscripcion' },
    });
  });

  it('si nunca hubo sesion manda al login pelado, no a sesion expirada', async () => {
    const router = TestBed.inject(Router);
    const navegarPorUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    // Sin token: un anonimo que entro por URL directa a algo que exige sesion. Decirle que
    // su sesion expiro seria mentirle sobre algo que nunca tuvo.
    const fallo = new Promise<unknown>((resolve) =>
      http.get('/api/v1/pacientes').subscribe({ error: resolve }),
    );

    httpMock.expectOne('/api/v1/pacientes').flush(null, { status: 401, statusText: 'x' });
    httpMock.expectOne('/api/v1/auth/refresh').flush(null, { status: 401, statusText: 'x' });

    await fallo;
    expect(navegarPorUrl).toHaveBeenCalledWith('/auth/ingresar');
    expect(navegar).not.toHaveBeenCalled();
  });

  it('un 401 del propio /auth/refresh NO dispara otro refresh', async () => {
    const session = TestBed.inject(SessionService);
    const fallo = new Promise<unknown>((resolve) =>
      session.refrescar().subscribe({ error: resolve }),
    );

    httpMock.expectOne('/api/v1/auth/refresh').flush(null, { status: 401, statusText: 'x' });

    await fallo;
    // Pedirle otro refresh al que acaba de decir "no hay sesion" es un bucle infinito.
    httpMock.verify();
  });

  it('un 401 de /auth/login NO dispara refresh: son credenciales incorrectas', async () => {
    const session = TestBed.inject(SessionService);
    const fallo = new Promise<unknown>((resolve) =>
      session.login('kine@akine.test', 'mala').subscribe({ error: resolve }),
    );

    httpMock
      .expectOne('/api/v1/auth/login')
      .flush(
        { type: 'https://akine.app/problems/invalid-credentials' },
        { status: 401, statusText: 'Unauthorized' },
      );

    await fallo;
    httpMock.verify();
  });

  it('un 403 NO limpia el token ni intenta renovar', async () => {
    tokenStore.set('jwt-valido');

    const fallo = new Promise<unknown>((resolve) =>
      http.get('/api/v1/pacientes').subscribe({ error: resolve }),
    );

    httpMock
      .expectOne('/api/v1/pacientes')
      .flush(
        { type: 'https://akine.app/problems/missing-tenant-context' },
        { status: 403, statusText: 'Forbidden' },
      );

    await fallo;
    // REGLA DURA: un 403 es "falta contexto" o "no tenes permiso", no "sesion invalida".
    // Borrar el token aca encierra al usuario en un bucle de login.
    expect(tokenStore.token()).toBe('jwt-valido');
    httpMock.verify();
  });

  it('no reintenta dos veces la misma peticion aunque el token nuevo tambien de 401', async () => {
    tokenStore.set('jwt-vencido');

    const fallo = new Promise<unknown>((resolve) =>
      http.get('/api/v1/pacientes').subscribe({ error: resolve }),
    );

    httpMock.expectOne('/api/v1/pacientes').flush(null, { status: 401, statusText: 'x' });
    httpMock
      .expectOne('/api/v1/auth/refresh')
      .flush({ accessToken: 'jwt-nuevo', scope: 'context' });
    httpMock.expectOne('/api/v1/pacientes').flush(null, { status: 401, statusText: 'x' });

    await fallo;
    // Sin la marca YA_REINTENTADA esto seria refresh -> reintento -> 401 -> refresh -> ...
    httpMock.verify();
  });

  it('un fallo de red no dispara refresh: no hay sesion que renovar', async () => {
    tokenStore.set('jwt-valido');

    const fallo = new Promise<unknown>((resolve) =>
      http.get('/api/v1/pacientes').subscribe({ error: resolve }),
    );

    httpMock
      .expectOne('/api/v1/pacientes')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

    await fallo;
    expect(tokenStore.token()).toBe('jwt-valido');
    httpMock.verify();
  });
});

/**
 * El interceptor de auth SOLO, sin el de errores por dentro.
 *
 * <p>En la composicion real nunca corre asi, pero el reconocimiento del 401 no puede
 * depender de que otro interceptor haya traducido el error antes: si alguien cambia el
 * orden en `app.config.ts`, el refresh tiene que seguir funcionando.
 */
describe('authInterceptor sin el interceptor de errores', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let tokenStore: AuthTokenStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideApi(''),
        provideRouter([]),
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    tokenStore = TestBed.inject(AuthTokenStore);
  });

  afterEach(() => httpMock.verify());

  it('reconoce el 401 en un HttpErrorResponse crudo y renueva igual', async () => {
    tokenStore.set('jwt-vencido');
    const resultado = new Promise((resolve) => http.get('/api/v1/pacientes').subscribe(resolve));

    httpMock.expectOne('/api/v1/pacientes').flush(null, { status: 401, statusText: 'x' });
    httpMock
      .expectOne('/api/v1/auth/refresh')
      .flush({ accessToken: 'jwt-nuevo', scope: 'context' });
    httpMock.expectOne('/api/v1/pacientes').flush({ ok: true });

    expect(await resultado).toEqual({ ok: true });
  });
});
