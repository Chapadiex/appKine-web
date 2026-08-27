import { ActivatedRouteSnapshot, Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { Type } from '@angular/core';

import { CatalogosPage } from './pages/catalogos/catalogos-page';
import { SolicitudesPage } from './pages/solicitudes/solicitudes-page';
import { VigenciasPage } from './pages/vigencias/vigencias-page';
import { NotFound } from '../../shared/pages/not-found/not-found';
import { PermissionsStore } from '../../core/services/permissions.store';
import { SessionService } from '../../core/services/session.service';
import { routes as rutasDeLaApp } from '../../app.routes';

/**
 * Pineo de los prefijos de ruta de `/catalogo` (M06, deuda de AKINE-01.02/02.03).
 *
 * <p>Misma forma que el resto de estos specs: navega de verdad contra `app.routes.ts` y
 * comprueba a que componente llega cada URL, sin confiar en que el path escrito en
 * `catalog.routes.ts` siga coincidiendo con lo que enlaza cada plantilla.
 *
 * <h2>`:tipo` es un catch-all de un segmento, y el test negativo tiene que respetarlo</h2>
 *
 * <p>A diferencia de `/horarios`, `/organizacion` y `/espacios` — que no tienen ninguna ruta
 * parametrica — `catalog.routes.ts` monta `:tipo` como ultima ruta estatica. Eso significa que
 * `/catalogo/inventado` NO cae en el comodin: matchea `:tipo` y resuelve a `CatalogosPage`,
 * que es el comportamiento correcto y existente desde AKINE-02.05 (cualquier string de un
 * segmento es, a priori, un tipo de catalogo valido hasta que el backend diga lo contrario).
 * El test negativo de este archivo usa una URL de tres segmentos, que no matchea ni `:tipo`
 * (uno) ni `nomencladores/:id/vigencias` (tres, pero el primero fijo), para probar que el
 * comodin real sigue alcanzable y que el test no es un `componenteDe` roto que siempre
 * devuelve algo distinto de `NotFound`.
 *
 * <p><b>Sin constante propia</b>, por el mismo motivo que `/organizacion` y `/espacios`.
 */
describe('Rutas de /catalogo', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(rutasDeLaApp),
        { provide: SessionService, useValue: { estado: () => 'activa' } },
        {
          provide: PermissionsStore,
          useValue: { cargados: () => true, tieneAlguno: () => true, tiene: () => true },
        },
      ],
    });

    router = TestBed.inject(Router);
  });

  it('/catalogo a secas redirige a especialidades, que es un tipo de catalogo', async () => {
    expect(await componenteDe('/catalogo')).toBe(CatalogosPage);
  });

  it('cada una de las rutas fijas resuelve a su pantalla', async () => {
    expect(await componenteDe('/catalogo/solicitudes')).toBe(SolicitudesPage);
    expect(await componenteDe('/catalogo/nomencladores/123/vigencias')).toBe(VigenciasPage);
    expect(await componenteDe('/catalogo/especialidades')).toBe(CatalogosPage);
  });

  it('ninguna de las rutas fijas cae en el comodin', async () => {
    const urls = [
      '/catalogo',
      '/catalogo/solicitudes',
      '/catalogo/nomencladores/123/vigencias',
      '/catalogo/especialidades',
    ];
    for (const url of urls) {
      expect(await componenteDe(url)).not.toBe(NotFound);
    }
  });

  it('un tipo de catalogo inventado matchea :tipo, a proposito, y no el comodin', async () => {
    // No es un hallazgo: es el comportamiento documentado de catalog.routes.ts desde 02.05.
    expect(await componenteDe('/catalogo/inventado')).toBe(CatalogosPage);
  });

  it('un path de tres segmentos que no matchea ninguna ruta si cae en el comodin', async () => {
    // Este es el test negativo real: prueba que el comodin sigue alcanzable y que el test
    // anterior no pasa porque `componenteDe` este roto.
    expect(await componenteDe('/catalogo/algo/de/mas')).toBe(NotFound);
  });

  /** Navega de verdad y devuelve el componente de la hoja activada. */
  async function componenteDe(url: string): Promise<Type<unknown> | null> {
    const navego = await router.navigateByUrl(url);
    expect(navego).toBe(true);

    let nodo: ActivatedRouteSnapshot = router.routerState.snapshot.root;
    while (nodo.firstChild !== null) {
      nodo = nodo.firstChild;
    }
    return nodo.component as Type<unknown> | null;
  }
});
