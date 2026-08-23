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

  it('un 401 limpia el token en memoria', async () => {
    tokenStore.set('jwt-vencido');
    const capturado = esperarError(http.get('/api/v1/pacientes'));

    httpMock
      .expectOne('/api/v1/pacientes')
      .flush({ status: 401 }, { status: 401, statusText: 'Unauthorized' });

    await capturado;
    // Dejar el token puesto solo produce una cascada de reintentos fallidos.
    expect(tokenStore.token()).toBeNull();
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

      httpMock.expectOne('/api/v1/organizations/1/consultorios').flush(
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
