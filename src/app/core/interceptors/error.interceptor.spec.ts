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
