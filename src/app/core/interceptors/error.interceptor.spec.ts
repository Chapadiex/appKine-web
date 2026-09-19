import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AkineHttpError, errorInterceptor } from './error.interceptor';
import { AuthTokenStore } from '../services/auth-token.store';

/**
 * Verifica el interceptor de errores (ADR-0005 del frontend, ADR-0005 del backend).
 *
 * <p>Traduce el ProblemDetail de RFC 7807 que produce el backend a un tipo unico que las
 * pantallas pueden consumir sin conocer HTTP.
 */
describe('errorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let tokenStore: AuthTokenStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    tokenStore = TestBed.inject(AuthTokenStore);
  });

  afterEach(() => httpMock.verify());

  it('traduce un ProblemDetail de validacion a AkineHttpError con los campos', async () => {
    const capturado = esperarError(http.get('/api/v1/pacientes'));

    httpMock.expectOne('/api/v1/pacientes').flush(
      {
        type: 'https://akine.app/problems/validation-error',
        title: 'Error de validacion',
        status: 400,
        detail: 'La solicitud contiene campos invalidos',
        errors: { email: 'debe ser una direccion valida' },
      },
      { status: 400, statusText: 'Bad Request' },
    );

    const error = await capturado;
    expect(error).toBeInstanceOf(AkineHttpError);
    expect(error.status).toBe(400);
    expect(error.message).toBe('La solicitud contiene campos invalidos');
    expect(error.erroresPorCampo['email']).toBe('debe ser una direccion valida');
    expect(error.esDeRed).toBe(false);
  });

  it('un 401 NO toca el token: el ciclo de vida de la sesion es del authInterceptor', async () => {
    tokenStore.set('jwt-vencido');
    const capturado = esperarError(http.get('/api/v1/pacientes'));

    httpMock
      .expectOne('/api/v1/pacientes')
      .flush({ status: 401 }, { status: 401, statusText: 'Unauthorized' });

    await capturado;
    // Cuando el borrado vivia aca, un 401 recuperable dejaba el token en null durante todo
    // el refresh y la aplicacion parpadeaba al login antes de volver sola. Quien sabe si
    // ese 401 termino en sesion recuperada o perdida es el authInterceptor, que es el que
    // corre el refresh: el borrado vive alla.
    expect(tokenStore.token()).toBe('jwt-vencido');
  });

  it('propaga los segundos de Retry-After de un 429', async () => {
    const capturado = esperarError(http.post('/api/v1/auth/login', {}));

    httpMock
      .expectOne('/api/v1/auth/login')
      .flush(
        { type: 'https://akine.app/problems/rate-limited', detail: 'Demasiados intentos' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '45' } },
      );

    const error = await capturado;
    // Sin esto la UI solo puede decir "demasiados intentos", que no dice cuanto esperar.
    expect(error.reintentarEnSegundos).toBe(45);
    expect(error.esRateLimited).toBe(true);
  });

  it('un 429 sin Retry-After visible no rompe: queda en null', async () => {
    const capturado = esperarError(http.post('/api/v1/auth/login', {}));

    httpMock
      .expectOne('/api/v1/auth/login')
      .flush(
        { type: 'https://akine.app/problems/rate-limited' },
        { status: 429, statusText: 'Too Many Requests' },
      );

    const error = await capturado;
    // El header solo es legible entre origenes si el backend lo expone en
    // Access-Control-Expose-Headers. Que no este no puede romper la pantalla.
    expect(error.reintentarEnSegundos).toBeNull();
    expect(error.esRateLimited).toBe(true);
  });

  it('reconoce los tipos de problema de identidad del contrato 0.3.0', async () => {
    const casos = [
      ['invalid-credentials', 401],
      ['invalid-refresh', 401],
      ['invalid-token', 401],
      ['unauthorized', 401],
      ['forbidden', 403],
      ['csrf-rejected', 403],
      ['not-found', 404],
      ['rate-limited', 429],
      ['validation-error', 400],
      ['internal-error', 500],
    ] as const;

    for (const [slug, status] of casos) {
      const capturado = esperarError(http.post('/api/v1/auth/login', {}));

      httpMock
        .expectOne('/api/v1/auth/login')
        .flush(
          { type: `https://akine.app/problems/${slug}`, status },
          { status, statusText: 'Error' },
        );

      expect((await capturado).problemType).toBe(slug);
    }
  });

  it('los tres rechazos de login son indistinguibles y la UI los trata igual', async () => {
    const capturado = esperarError(http.post('/api/v1/auth/login', {}));

    httpMock.expectOne('/api/v1/auth/login').flush(
      {
        type: 'https://akine.app/problems/invalid-credentials',
        detail: 'Email o contrasena incorrectos',
      },
      { status: 401, statusText: 'Unauthorized' },
    );

    const error = await capturado;
    // ADR-0018: email inexistente, contrasena incorrecta y cuenta bloqueada devuelven los
    // tres esto mismo. Un solo mensaje, sin adivinar cual fue.
    expect(error.esCredencialesInvalidas).toBe(true);
    expect(error.mensaje).toBe('Email o contrasena incorrectos');
  });

  it('marca como sesion expirada los tres problemas que obligan a volver al login', async () => {
    for (const slug of ['invalid-refresh', 'invalid-token', 'unauthorized'] as const) {
      const capturado = esperarError(http.get('/api/v1/pacientes'));

      httpMock
        .expectOne('/api/v1/pacientes')
        .flush({ type: `https://akine.app/problems/${slug}` }, { status: 401, statusText: 'x' });

      expect((await capturado).esSesionExpirada).toBe(true);
    }
  });

  it('lee los errores de validacion tambien cuando vienen anidados en properties', async () => {
    const capturado = esperarError(http.post('/api/v1/auth/register', {}));

    // Hueco de contrato: ProblemDetail 0.3.0 declara `properties` pero no `errors`. Spring
    // los serializa en la raiz; se aceptan las dos formas para que un cambio de forma del
    // backend no deje el formulario sin marcar campos.
    httpMock.expectOne('/api/v1/auth/register').flush(
      {
        type: 'https://akine.app/problems/validation-error',
        properties: { errors: { password: 'debe tener al menos 12 caracteres' } },
      },
      { status: 400, statusText: 'Bad Request' },
    );

    const error = await capturado;
    expect(error.erroresPorCampo['password']).toBe('debe tener al menos 12 caracteres');
  });

  it('distingue un fallo de red de un error del servidor', async () => {
    const capturado = esperarError(http.get('/api/v1/pacientes'));

    httpMock
      .expectOne('/api/v1/pacientes')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

    const error = await capturado;
    // status 0 = la peticion nunca llego. La UI debe decir "sin conexion", no "error del
    // servidor": son problemas distintos con acciones distintas.
    expect(error.esDeRed).toBe(true);
    expect(error.status).toBe(0);
  });

  it('un 500 sin cuerpo util igual produce un mensaje mostrable', async () => {
    const capturado = esperarError(http.get('/api/v1/pacientes'));

    httpMock
      .expectOne('/api/v1/pacientes')
      .flush(null, { status: 500, statusText: 'Internal Server Error' });

    const error = await capturado;
    expect(error.status).toBe(500);
    expect(error.message).toBeTruthy();
    expect(error.erroresPorCampo).toEqual({});
  });

  it('reconoce los tipos de problema del contrato 0.2.0 por su URI', async () => {
    const casos = [
      ['plan-limit-exceeded', 409],
      ['feature-not-available', 403],
      ['subscription-suspended', 409],
      ['invalid-subscription-transition', 409],
      ['idempotency-key-conflict', 409],
      ['conflict', 409],
      ['missing-tenant-context', 403],
    ] as const;

    for (const [slug, status] of casos) {
      const capturado = esperarError(http.post('/api/v1/organizations/1/consultorios', {}));

      httpMock
        .expectOne('/api/v1/organizations/1/consultorios')
        .flush(
          { type: `https://akine.app/problems/${slug}`, status, detail: 'irrelevante' },
          { status, statusText: 'Error' },
        );

      const error = await capturado;
      // La pantalla ramifica por este identificador y no parseando `detail`, que es prosa
      // para humanos y cambia sin avisar.
      expect(error.problemType).toBe(slug);
    }
  });

  it('un tipo desconocido devuelve null en vez del segmento crudo', async () => {
    const capturado = esperarError(http.get('/api/v1/pacientes'));

    httpMock
      .expectOne('/api/v1/pacientes')
      .flush(
        { type: 'https://akine.app/problems/algo-que-todavia-no-existe' },
        { status: 409, statusText: 'Conflict' },
      );

    const error = await capturado;
    // Devolver el segmento crudo dejaria al `switch` de la pantalla creyendo que reconocio
    // algo que no reconoce.
    expect(error.problemType).toBeNull();
  });

  it('un error sin ProblemDetail no tiene tipo', async () => {
    const capturado = esperarError(http.get('/api/v1/pacientes'));

    httpMock
      .expectOne('/api/v1/pacientes')
      .flush(null, { status: 500, statusText: 'Internal Server Error' });

    const error = await capturado;
    expect(error.problemType).toBeNull();
    expect(error.esSuscripcionSuspendida).toBe(false);
    expect(error.faltaContexto).toBe(false);
  });

  it('expone los dos casos que mas ramifican las pantallas', async () => {
    const suspendida = esperarError(http.post('/api/v1/turnos', {}));
    httpMock
      .expectOne('/api/v1/turnos')
      .flush(
        { type: 'https://akine.app/problems/subscription-suspended' },
        { status: 409, statusText: 'Conflict' },
      );
    expect((await suspendida).esSuscripcionSuspendida).toBe(true);

    const sinContexto = esperarError(http.get('/api/v1/turnos'));
    httpMock
      .expectOne('/api/v1/turnos')
      .flush(
        { type: 'https://akine.app/problems/missing-tenant-context' },
        { status: 403, statusText: 'Forbidden' },
      );
    expect((await sinContexto).faltaContexto).toBe(true);
  });

  it('un 403 de negocio no limpia el token: el backend nunca emite 401 desde ahi', async () => {
    tokenStore.set('jwt-valido');
    const capturado = esperarError(http.get('/api/v1/organizations/1'));

    httpMock
      .expectOne('/api/v1/organizations/1')
      .flush(
        { type: 'https://akine.app/problems/missing-tenant-context' },
        { status: 403, statusText: 'Forbidden' },
      );

    await capturado;
    // Limpiarlo mandaria al usuario a un login que no hacia falta.
    expect(tokenStore.token()).toBe('jwt-valido');
  });

  it('lee el ProblemDetail que viene dentro de un Blob: la descarga no pierde su tipo', async () => {
    // Una peticion binaria -`responseType: 'blob'`, que es como se baja un adjunto- recibe el
    // cuerpo del error tambien como Blob. Un Blob es un objeto no nulo, asi que pasaba por
    // ProblemDetail sin serlo y `problemType` quedaba en null: la pantalla perdia el unico
    // mensaje accionable del caso.
    const capturado = esperarError(
      http.get('/api/v1/personas/7/adjuntos/3/contenido', { responseType: 'blob' }),
    );

    httpMock.expectOne('/api/v1/personas/7/adjuntos/3/contenido').flush(
      new Blob(
        [
          JSON.stringify({
            type: 'https://akine.app/problems/adjunto-no-disponible',
            detail: 'el almacenamiento perdio el binario',
          }),
        ],
        { type: 'application/problem+json' },
      ),
      { status: 409, statusText: 'Conflict' },
    );

    const error = await capturado;
    expect(error.problemType).toBe('adjunto-no-disponible');
    expect(error.message).toBe('el almacenamiento perdio el binario');
  });

  it('si el Blob del error no se puede leer, igual sale un AkineHttpError', async () => {
    // Leer un Blob puede fallar -archivo detras del Blob ya no disponible-. Si esa promesa
    // rechazada subiera, la pantalla recibiria un error que no es un AkineHttpError y su
    // traductor se caeria encima del rechazo original.
    const ilegible = new Blob(['no importa']);
    Object.defineProperty(ilegible, 'text', {
      value: () => Promise.reject(new Error('no se puede leer')),
    });

    const capturado = esperarError(
      http.get('/api/v1/personas/7/adjuntos/3/contenido', { responseType: 'blob' }),
    );

    httpMock
      .expectOne('/api/v1/personas/7/adjuntos/3/contenido')
      .flush(ilegible, { status: 409, statusText: 'Conflict' });

    const error = await capturado;
    expect(error).toBeInstanceOf(AkineHttpError);
    expect(error.problemType).toBeNull();
  });

  it('un Blob vacio no se intenta parsear: un 500 sin cuerpo sigue siendo un 500', async () => {
    const capturado = esperarError(
      http.get('/api/v1/personas/7/adjuntos/3/contenido', { responseType: 'blob' }),
    );

    httpMock
      .expectOne('/api/v1/personas/7/adjuntos/3/contenido')
      .flush(new Blob([]), { status: 500, statusText: 'Internal Server Error' });

    const error = await capturado;
    expect(error.problemType).toBeNull();
    expect(error.status).toBe(500);
  });

  it('un Blob que no es JSON no inventa un tipo: queda sin problemType y no rompe', async () => {
    // La pagina HTML de un proxy, un cuerpo vacio, el texto de un gateway. Nada de eso es un
    // problema de la API y forzarlo seria inventarle un `type` al rechazo.
    const capturado = esperarError(
      http.get('/api/v1/personas/7/adjuntos/3/contenido', { responseType: 'blob' }),
    );

    httpMock
      .expectOne('/api/v1/personas/7/adjuntos/3/contenido')
      .flush(new Blob(['<html>502 Bad Gateway</html>'], { type: 'text/html' }), {
        status: 502,
        statusText: 'Bad Gateway',
      });

    const error = await capturado;
    expect(error.problemType).toBeNull();
    expect(error.status).toBe(502);
    expect(error.esDeRed).toBe(false);
  });

  it('una respuesta exitosa pasa sin tocar', async () => {
    const respuesta = new Promise((resolve) => http.get('/api/v1/version').subscribe(resolve));

    httpMock.expectOne('/api/v1/version').flush({ application: 'akine-api' });

    expect(await respuesta).toEqual({ application: 'akine-api' });
  });
});

/** Resuelve con el error que emite el observable. Falla si el observable no falla. */
function esperarError(observable: {
  subscribe: (o: { next: () => void; error: (e: unknown) => void }) => void;
}): Promise<AkineHttpError> {
  return new Promise<AkineHttpError>((resolve, reject) => {
    observable.subscribe({
      next: () => reject(new Error('se esperaba un error y la peticion tuvo exito')),
      error: (error: unknown) => resolve(error as AkineHttpError),
    });
  });
}
