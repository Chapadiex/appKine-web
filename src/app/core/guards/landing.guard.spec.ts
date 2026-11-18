import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { Observable } from 'rxjs';

import { landingGuard } from './landing.guard';
import { SessionService } from '../services/session.service';
import { provideApi } from '../../api/generated/provide-api';

describe('landingGuard', () => {
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

  it('sin sesión muestra la landing', () => {
    expect(correr()).toBe(true);
  });

  it('con sesión manda al inicio', () => {
    session.login('kine@akine.test', 'clave-sintetica').subscribe();
    httpMock.expectOne('/api/v1/auth/login').flush({ accessToken: 'jwt', scope: 'pre_context' });

    const resultado = correr();

    expect(resultado).toBeInstanceOf(UrlTree);
    expect((resultado as UrlTree).toString()).toBe('/agenda');
  });

  it('con la restauración en vuelo espera: quien tiene sesión no ve la landing', () => {
    session.iniciarRestauracion();
    const resultados: unknown[] = [];

    (correr() as Observable<unknown>).subscribe((r) => resultados.push(r));
    expect(resultados).toEqual([]);
    httpMock
      .expectOne('/api/v1/auth/refresh')
      .flush({ accessToken: 'jwt-restaurado', scope: 'pre_context' });

    expect((resultados[0] as UrlTree).toString()).toBe('/agenda');
  });

  function correr(): unknown {
    return TestBed.runInInjectionContext(() =>
      landingGuard(
        {} as ActivatedRouteSnapshot,
        {
          url: '/',
          root: { routeConfig: null, firstChild: null },
        } as unknown as RouterStateSnapshot,
      ),
    );
  }
});
