import { ActivatedRouteSnapshot, Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { Type } from '@angular/core';

import { ContextSelectorPage } from './features/organization/pages/context-selector/context-selector-page';
import { Estado } from './features/platform/pages/estado/estado';
import { NotFound } from './shared/pages/not-found/not-found';
import { SinPermiso } from './shared/pages/sin-permiso/sin-permiso';
import { RUTA_INICIO } from './layout/navegacion-principal/secciones';
import { RUTA_SELECTOR_CONTEXTO, RUTA_SIN_PERMISO } from './core/models/rutas';
import { SessionService } from './core/services/session.service';
import { routes } from './app.routes';

/**
 * Pineo de las rutas que se montan directamente en `app.routes.ts` (deuda de
 * AKINE-01.02/02.03) y que ninguna feature especifica cubre: la raiz, el selector de
 * contexto, la pantalla de "sin permiso" y el comodin.
 *
 * <p>Las cuatro features con `loadChildren` (`auth`, `organizacion`, `espacios`, `catalogo`)
 * tienen su propio spec de rutas junto al archivo que montan —`auth.routes.spec.ts`,
 * `organization.routes.spec.ts`, `resource.routes.spec.ts`, `catalog.routes.spec.ts`—, y cada
 * uno de ellos ya prueba, como parte de pinear sus hijas, que el prefijo raiz de la feature
 * resuelve (su test de la ruta vacia navega justamente a `/organizacion`, `/espacios`, etc.).
 * Repetirlo aca seria el mismo test dos veces.
 *
 * <p>Misma forma que el resto: navega de verdad contra la configuracion real de
 * `app.routes.ts` y comprueba a que componente llega cada URL.
 */
describe('Rutas de la raiz de la app', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: SessionService, useValue: { estado: () => 'activa' } },
      ],
    });

    router = TestBed.inject(Router);
  });

  /**
   * La raiz ya no es el baseline tecnico: redirige al inicio del producto. Se comprueba la
   * URL final y no el componente, porque lo que este test pinea es el destino de la
   * redireccion —el componente lo pinea el spec de la feature que lo monta—.
   */
  it('la raiz redirige al inicio del producto', async () => {
    await router.navigateByUrl('/');

    expect(router.url).toBe(RUTA_INICIO);
  });

  it('el baseline tecnico sigue alcanzable en su propia URL', async () => {
    expect(await componenteDe('/estado')).toBe(Estado);
  });

  it('el selector de contexto resuelve a su pantalla', async () => {
    expect(await componenteDe(RUTA_SELECTOR_CONTEXTO)).toBe(ContextSelectorPage);
  });

  it('sin-permiso resuelve a su pantalla', async () => {
    expect(await componenteDe(RUTA_SIN_PERMISO)).toBe(SinPermiso);
  });

  it('ninguna de las tres cae en el comodin', async () => {
    for (const url of ['/estado', RUTA_SELECTOR_CONTEXTO, RUTA_SIN_PERMISO]) {
      expect(await componenteDe(url)).not.toBe(NotFound);
    }
  });

  it('una URL que no monta ninguna feature cae en el comodin', async () => {
    // La contracara de los tests anteriores: sin esto, un `componenteDe` roto que devolviera
    // siempre algo distinto de NotFound haria pasar la afirmacion de arriba sin probar nada.
    expect(await componenteDe('/esto-no-existe')).toBe(NotFound);
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
