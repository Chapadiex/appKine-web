import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { Observable, firstValueFrom, isObservable } from 'rxjs';

import { PlatformRoleStore } from './platform-role.store';
import { SessionService } from './session.service';
import { platformAdminGuard } from '../guards/platform-admin.guard';
import { provideApi } from '../../api/generated/provide-api';

const ROL = '/api/v1/me/platform-role';

/**
 * Rol de plataforma y su guard (AKINE-A-7). Lo que importa: una consulta por sesion, que se
 * invalida al cambiar de identidad, y que el guard empuje a donde corresponde. Es UX: el
 * backend verifica el rol en cada request.
 */
describe('PlatformRoleStore y platformAdminGuard', () => {
  let session: SessionService;
  let store: PlatformRoleStore;
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
    store = TestBed.inject(PlatformRoleStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('pregunta una sola vez por sesion y vuelve a preguntar despues de un logout', async () => {
    autenticar();

    const primera = firstValueFrom(store.resolver());
    // Dos consumidores a la vez comparten la misma peticion.
    const segunda = firstValueFrom(store.resolver());
    httpMock.expectOne(ROL).flush({ platformAdmin: true });

    expect(await primera).toBe(true);
    expect(await segunda).toBe(true);
    expect(store.esAdminDePlataforma()).toBe(true);
    expect(await firstValueFrom(store.resolver())).toBe(true); // de cache, sin red

    session.limpiarSesion();
    expect(store.esAdminDePlataforma()).toBe(false);
    expect(await firstValueFrom(store.resolver())).toBe(false); // anonimo: sin red

    autenticar();
    store.asegurarCargado();
    httpMock.expectOne(ROL).flush({ platformAdmin: false });
    expect(store.cargado()).toBe(true);
    expect(store.esAdminDePlataforma()).toBe(false);
  });

  it('si la consulta falla responde false y no lo cachea', async () => {
    autenticar();

    const respuesta = firstValueFrom(store.resolver());
    httpMock.expectOne(ROL).flush(null, { status: 500, statusText: 'Error' });

    expect(await respuesta).toBe(false);
    expect(store.cargado()).toBe(false);
  });

  it('el guard: sin sesion al login, sin rol a "sin permiso", con rol deja pasar', async () => {
    expect(urlDe(correr('/plataforma/solicitudes'))).toContain('/auth/ingresar');

    autenticar();
    const sinRol = resolver(correr('/plataforma/solicitudes'));
    httpMock.expectOne(ROL).flush({ platformAdmin: false });
    expect(urlDe(await sinRol)).toBe('/sin-permiso');

    session.limpiarSesion();
    autenticar();
    const conRol = resolver(correr('/plataforma/solicitudes'));
    httpMock.expectOne(ROL).flush({ platformAdmin: true });
    expect(await conRol).toBe(true);
  });

  function autenticar(): void {
    session.login('admin@akine.test', 'clave-sintetica').subscribe();
    httpMock.expectOne('/api/v1/auth/login').flush({ accessToken: 'jwt', scope: 'pre_context' });
  }

  function correr(url: string): boolean | UrlTree | Observable<boolean | UrlTree> {
    return TestBed.runInInjectionContext(
      () =>
        platformAdminGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot) as
          boolean | UrlTree | Observable<boolean | UrlTree>,
    );
  }

  function resolver(
    resultado: boolean | UrlTree | Observable<boolean | UrlTree>,
  ): Promise<boolean | UrlTree> {
    return isObservable(resultado) ? firstValueFrom(resultado) : Promise.resolve(resultado);
  }

  function urlDe(resultado: unknown): string {
    return resultado instanceof UrlTree ? resultado.toString() : String(resultado);
  }
});
