import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';

import { authGuard } from './auth.guard';
import { contextGuard } from './context.guard';
import { DiaDeLaSede } from '../services/dia-de-la-sede';
import { SessionService } from '../services/session.service';
import { fijarReloj, soltarReloj } from '../testing/reloj';
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

    it('con contexto activo deja pasar sin esperar la zona, y corrige el default cuando llega', () => {
      // 00:25 UTC del 10/10 con el navegador en UTC: en Cordoba siguen siendo las 21:25 del 09/10.
      fijarReloj('2026-10-10T00:25:00Z', { navegadorEnUtc: true });
      try {
        autenticar('context');
        const dia = TestBed.inject(DiaDeLaSede);

        // No bloquea: deja pasar en el acto y, mientras tanto, "hoy" es el del navegador.
        expect(correr(contextGuard, '/organizacion')).toBe(true);
        expect(dia.hoy()).toBe('2026-10-10');
        let fecha = dia.hoy();
        TestBed.runInInjectionContext(() =>
          dia.alinear(
            () => fecha,
            (hoy) => (fecha = hoy),
          ),
        );

        httpMock
          .expectOne((req) => req.url === '/api/v1/organizations/1/consultorios')
          .flush({ content: [{ id: 10, timezone: 'America/Argentina/Cordoba' }] });

        expect(dia.hoy()).toBe('2026-10-09');
        expect(fecha).toBe('2026-10-09');
      } finally {
        soltarReloj();
      }
    });

    it('sin la sede en el listado cae a la zona de la organizacion, y un error no rompe nada', () => {
      autenticar('context');

      expect(correr(contextGuard, '/organizacion')).toBe(true);
      // Una segunda navegacion con la carga en vuelo no la repite.
      expect(correr(contextGuard, '/organizacion')).toBe(true);
      httpMock
        .expectOne((req) => req.url === '/api/v1/organizations/1/consultorios')
        .flush({ content: [] });
      httpMock
        .expectOne('/api/v1/organizations/1')
        .flush(null, { status: 500, statusText: 'Server Error' });

      expect(TestBed.inject(DiaDeLaSede).zona()).toBe('');
    });
  });

  // --- Ayudas ----------------------------------------------------------------------

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
