import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { authInterceptor } from './auth.interceptor';
import { AuthTokenStore } from '../services/auth-token.store';

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
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
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
});
