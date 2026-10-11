import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';

import { Observable, isObservable } from 'rxjs';

import { authGuard } from './auth.guard';
import { contextGuard } from './context.guard';
import { SessionService } from '../services/session.service';
import { provideApi } from '../../api/generated/provide-api';

/**
 * Verifica los guards de sesion y de contexto (AKINE-01.02).
 *
 * <p>Se prueba a donde empujan, no que "protejan": son UX. El backend rechaza igual a
 * quien llegue por URL directa, y ninguna aserto de este archivo es una garantia de
 * seguridad.
 */
describe('guards de sesion', () => {
  let session: SessionService;
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
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('authGuard', () => {
    it('sin sesion manda al login recordando a donde queria ir', () => {
      const resultado = correr(authGuard, '/organizacion/1/suscripcion');

      expect(resultado).toBeInstanceOf(UrlTree);
      const url = (resultado as UrlTree).toString();
      expect(url).toContain('/auth/ingresar');
      // Sin esto el usuario vuelve a la home y tiene que buscar de nuevo donde estaba.
      expect(url).toContain('volverA=%2Forganizacion%2F1%2Fsuscripcion');
    });

    it('con sesion sin contexto deja pasar: eso lo decide contextGuard', () => {
      autenticar('pre_context');

      expect(correr(authGuard, '/seleccionar-contexto')).toBe(true);
    });

    it('con sesion activa deja pasar', () => {
      autenticar('context');

      expect(correr(authGuard, '/organizacion')).toBe(true);
    });
  });

  describe('contextGuard', () => {
    it('sin contexto elegido manda al selector', () => {
      autenticar('pre_context');

      const resultado = correr(contextGuard, '/organizacion');

      expect(resultado).toBeInstanceOf(UrlTree);
      const url = (resultado as UrlTree).toString();
      // Con pre_context ningun endpoint de negocio responde: montar la pantalla solo
      // sirve para llenarla de 403 missing-tenant-context.
      expect(url).toContain('/seleccionar-contexto');
      expect(url).toContain('volverA=%2Forganizacion');
    });

    it('sin sesion manda al login, no al selector', () => {
      const resultado = correr(contextGuard, '/organizacion');

      expect((resultado as UrlTree).toString()).toContain('/auth/ingresar');
    });

    it('con contexto activo deja pasar', () => {
      autenticar('context');

      expect(correr(contextGuard, '/organizacion')).toBe(true);
    });
  });

  // El arranque ya no espera la restauracion de la sesion (AKINE-LCP): la esperan los guards.
  describe('con la restauracion del arranque en vuelo', () => {
    it('authGuard espera el refresh en vez de mandar al login a quien tiene sesion', () => {
      session.iniciarRestauracion();
      const resultados: unknown[] = [];

      observar(correr(authGuard, '/agenda')).subscribe((r) => resultados.push(r));
      expect(resultados).toEqual([]);

      httpMock
        .expectOne('/api/v1/auth/refresh')
        .flush({ accessToken: 'jwt-restaurado', scope: 'pre_context' });

      expect(resultados).toEqual([true]);
    });

    it('contextGuard decide con los nombres ya rehidratados, no antes', () => {
      session.iniciarRestauracion();
      const resultados: unknown[] = [];

      observar(correr(contextGuard, '/agenda')).subscribe((r) => resultados.push(r));
      httpMock.expectOne('/api/v1/auth/refresh').flush({
        accessToken: 'jwt-ctx',
        scope: 'context',
        organizationId: 1,
        consultorioId: 10,
      });
      expect(resultados).toEqual([]);

      httpMock.expectOne('/api/v1/me/contexts').flush([]);
      expect(resultados).toEqual([true]);
    });

    it('sin cookie, terminada la restauracion, manda al login', () => {
      session.iniciarRestauracion();
      const resultados: unknown[] = [];

      observar(correr(authGuard, '/agenda')).subscribe((r) => resultados.push(r));
      httpMock
        .expectOne('/api/v1/auth/refresh')
        .flush(
          { type: 'https://akine.app/problems/invalid-refresh' },
          { status: 401, statusText: 'Unauthorized' },
        );

      expect(resultados).toHaveLength(1);
      expect((resultados[0] as UrlTree).toString()).toContain('/auth/ingresar');
    });

    it('mientras espera, precarga el componente de la pantalla de destino', () => {
      session.iniciarRestauracion();
      const cargarPantalla = vi.fn(() => Promise.resolve(class {}));
      const destino = {
        routeConfig: null,
        firstChild: { routeConfig: { loadComponent: cargarPantalla }, firstChild: null },
      } as unknown as ActivatedRouteSnapshot;

      observar(
        TestBed.runInInjectionContext(() =>
          authGuard(
            {} as ActivatedRouteSnapshot,
            {
              url: '/agenda',
              root: destino,
            } as RouterStateSnapshot,
          ),
        ),
      ).subscribe();

      // Adelanta el import que el router haria despues de los guards: no decide nada.
      expect(cargarPantalla).toHaveBeenCalledTimes(1);
      httpMock
        .expectOne('/api/v1/auth/refresh')
        .flush({ accessToken: 'jwt-restaurado', scope: 'pre_context' });
    });

    it('sin restauracion en vuelo no precarga nada: el router lo hace a su tiempo', () => {
      const cargarPantalla = vi.fn(() => Promise.resolve(class {}));
      const destino = {
        firstChild: { routeConfig: { loadComponent: cargarPantalla }, firstChild: null },
      } as unknown as ActivatedRouteSnapshot;

      TestBed.runInInjectionContext(() =>
        authGuard(
          {} as ActivatedRouteSnapshot,
          {
            url: '/agenda',
            root: destino,
          } as RouterStateSnapshot,
        ),
      );

      expect(cargarPantalla).not.toHaveBeenCalled();
    });
  });

  // --- Ayudas ----------------------------------------------------------------------

  function observar(resultado: unknown): Observable<unknown> {
    expect(isObservable(resultado)).toBe(true);
    return resultado as Observable<unknown>;
  }

  /** Autentica de verdad, contra el flujo real, para no falsear el estado del servicio. */
  function autenticar(scope: 'pre_context' | 'context'): void {
    session.login('kine@akine.test', 'clave-sintetica').subscribe();
    httpMock.expectOne('/api/v1/auth/login').flush({ accessToken: 'jwt', scope: 'pre_context' });

    if (scope === 'context') {
      session.seleccionarContexto(1, 10).subscribe();
      httpMock.expectOne('/api/v1/auth/context').flush({
        accessToken: 'jwt-ctx',
        scope: 'context',
        organizationId: 1,
        consultorioId: 10,
      });
    }
  }

  function correr(
    guard: typeof authGuard,
    url: string,
  ): boolean | UrlTree | Promise<boolean | UrlTree> {
    return TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    ) as boolean | UrlTree;
  }
});
