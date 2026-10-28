import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PerfilPropioStore } from './perfil-propio.store';
import { SessionService } from './session.service';
import { TenantContextStore } from './tenant-context.store';
import { provideApi } from '../../api/generated/provide-api';

const ME = '/api/v1/me';

const ANA = {
  accountId: 7,
  firstName: 'Ana',
  lastName: 'Prueba',
  email: 'ana@akine.test',
  context: {
    organizationId: 1,
    consultorioId: 10,
    roleCode: 'ORG_ADMIN',
    roleLabel: 'Administración',
  },
};

/**
 * Perfil propio (DP-45). Lo que importa: una consulta por cuenta y contexto, que el refresh del
 * token (mismo contexto) no la repite, y que cambiar de sede o de cuenta la invalida en el acto y
 * descarta la respuesta que llega tarde.
 */
describe('PerfilPropioStore', () => {
  let session: SessionService;
  let tenant: TenantContextStore;
  let store: PerfilPropioStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi(''),
        provideRouter([]),
      ],
    });
    session = TestBed.inject(SessionService);
    tenant = TestBed.inject(TenantContextStore);
    store = TestBed.inject(PerfilPropioStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('pregunta una vez por cuenta y sede, y no repite por un refresh del mismo contexto', () => {
    store.asegurarCargado(); // anonimo: sin red
    httpMock.expectNone(ME);

    autenticar();
    elegir(10);
    store.asegurarCargado();
    store.asegurarCargado(); // en vuelo: no sale otra
    httpMock.expectOne(ME).flush(ANA);
    expect(store.perfil()?.context?.roleLabel).toBe('Administración');

    // Un refresh vuelve a fijar el mismo contexto y avanza `contextEpoch`: el perfil sigue.
    elegir(10);
    store.asegurarCargado();
    httpMock.expectNone(ME);
    expect(store.perfil()?.firstName).toBe('Ana');

    // Otra sede puede ser otro rol: deja de valer en el acto y la respuesta vieja se descarta.
    elegir(20);
    expect(store.perfil()).toBeNull();
    store.asegurarCargado();
    const tardia = httpMock.expectOne(ME);
    session.limpiarSesion();
    tardia.flush(ANA);
    expect(store.perfil()).toBeNull();
  });

  it('si la consulta falla queda sin perfil y se puede volver a pedir', () => {
    autenticar();
    elegir(10);
    store.asegurarCargado();
    httpMock.expectOne(ME).flush(null, { status: 500, statusText: 'Error' });
    expect(store.perfil()).toBeNull();

    store.asegurarCargado();
    httpMock.expectOne(ME).flush(ANA);
    expect(store.perfil()?.lastName).toBe('Prueba');
  });

  function autenticar(): void {
    session.login('ana@akine.test', 'clave-sintetica').subscribe();
    httpMock.expectOne('/api/v1/auth/login').flush({ accessToken: 'jwt', scope: 'pre_context' });
  }

  function elegir(consultorioId: number): void {
    tenant.select({ organizationId: 1, organizationName: 'Centro Kine', consultorioId });
  }
});
