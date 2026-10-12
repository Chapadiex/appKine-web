import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { provideApi } from '../../../api/generated/provide-api';
import { SessionService } from '../../../core/services/session.service';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { PrecargaDeFicha, precargarResumenDeFicha } from './precarga-de-ficha';

const RESUMEN_7 = '/api/v1/personas/7/resumen';
const TOKEN_CON_CONTEXTO = {
  accessToken: 'jwt',
  scope: 'context',
  organizationId: 1,
  consultorioId: 2,
};

/**
 * Precarga del Paciente 360 (AKINE-LCP). Lo que importa: que la consulta salga apenas hay token
 * —sin esperar a la pantalla—, una sola vez, y que solo la tome la misma persona en el mismo
 * contexto: una respuesta precargada nunca puede aparecer bajo otra sede.
 */
describe('PrecargaDeFicha', () => {
  let session: SessionService;
  let precarga: PrecargaDeFicha;
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
    precarga = TestBed.inject(PrecargaDeFicha);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('sale apenas vuelve el refresh, una sola vez, y la pantalla toma esa respuesta', async () => {
    session.refrescar().subscribe();
    const refresh = httpMock.expectOne('/api/v1/auth/refresh');

    // Cada guard de la cadena llama a la precarga de la ruta: tiene que ser idempotente.
    precargarDesdeLaRuta('7');
    precargarDesdeLaRuta('7');
    httpMock.expectNone(RESUMEN_7);

    refresh.flush(TOKEN_CON_CONTEXTO);
    httpMock.expectOne(RESUMEN_7).flush({ persona: { id: 7 } });

    const tomada = precarga.tomar(7);
    expect(tomada).not.toBeNull();
    expect(await firstValueFrom(tomada!)).toEqual({ persona: { id: 7 } });
    // Se toma una sola vez: la recarga de la pantalla vuelve a consultar.
    expect(precarga.tomar(7)).toBeNull();
  });

  it('no la toma otra persona ni otro contexto', () => {
    conContexto();

    precarga.precargar(7);
    httpMock.expectOne(RESUMEN_7).flush({});
    expect(precarga.tomar(8)).toBeNull();
    expect(precarga.tomar(7)).toBeNull(); // tomar(8) la descarto

    precarga.precargar(7);
    httpMock.expectOne(RESUMEN_7).flush({});
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Otra',
      consultorioId: 3,
      consultorioName: 'Otra sede',
    });
    expect(precarga.tomar(7)).toBeNull();
  });

  it('sin contexto, o con un id que no es de persona, no consulta nada', () => {
    session.login('admin@akine.test', 'clave-sintetica').subscribe();
    httpMock.expectOne('/api/v1/auth/login').flush({ accessToken: 'jwt', scope: 'pre_context' });

    precarga.precargar(7);
    precargarDesdeLaRuta('abc');
    httpMock.expectNone(RESUMEN_7);
    expect(precarga.tomar(7)).toBeNull();
  });

  it('si la precarga fallo, la pantalla que la toma vuelve a consultar y recibe su propio error', async () => {
    conContexto();

    precarga.precargar(7);
    httpMock.expectOne(RESUMEN_7).flush(null, { status: 503, statusText: 'Unavailable' });

    // Un error no queda guardado: es la pantalla la que decide que mostrar, con una consulta
    // propia (un corte transitorio durante el arranque no se le muestra a nadie).
    const tomada = firstValueFrom(precarga.tomar(7)!);
    httpMock.expectOne(RESUMEN_7).flush(null, { status: 403, statusText: 'Forbidden' });
    await expect(tomada).rejects.toBeTruthy();
  });

  function conContexto(): void {
    session.login('admin@akine.test', 'clave-sintetica').subscribe();
    httpMock.expectOne('/api/v1/auth/login').flush(TOKEN_CON_CONTEXTO);
  }

  function precargarDesdeLaRuta(personaId: string): void {
    TestBed.runInInjectionContext(() =>
      precargarResumenDeFicha({
        paramMap: convertToParamMap({ personaId }),
      } as ActivatedRouteSnapshot),
    );
  }
});
