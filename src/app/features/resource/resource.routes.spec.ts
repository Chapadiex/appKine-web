import { ActivatedRouteSnapshot, Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { Type } from '@angular/core';

import { DisponibilidadPage } from './pages/disponibilidad/disponibilidad-page';
import { EspaciosPage } from './pages/espacios/espacios-page';
import { NewEspacioPage } from './pages/new-espacio/new-espacio-page';
import { NotFound } from '../../shared/pages/not-found/not-found';
import { PermissionsStore } from '../../core/services/permissions.store';
import { SessionService } from '../../core/services/session.service';
import { routes as rutasDeLaApp } from '../../app.routes';

/**
 * Pineo de los prefijos de ruta de `/espacios` (M04, deuda de AKINE-01.02/02.03).
 *
 * <p>Mismo archivo de routing que pinea `horarios.routes.spec.ts` para `/horarios`
 * (AKINE-02.04), pero para la OTRA feature que vive en `resource.routes.ts`: espacios y boxes
 * (AKINE-02.02). No se toca nada de `horarios.routes.ts` ni de `pages/` de esa etapa — este
 * archivo es nuevo y vive junto a `resource.routes.ts`, no adentro de `pages/`.
 *
 * <p>Misma forma que el resto de estos specs: navega de verdad contra `app.routes.ts` y
 * comprueba a que componente llega cada URL.
 *
 * <p><b>Sin constante propia</b>, por el mismo motivo que `/organizacion`: ningun archivo de
 * `resource` concentra estos tres literales para la familia de `/espacios` y crear uno no es
 * parte de esta tarea.
 */
describe('Rutas de /espacios', () => {
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

  it('cada una de las tres resuelve a su pantalla', async () => {
    expect(await componenteDe('/espacios/nuevo')).toBe(NewEspacioPage);
    expect(await componenteDe('/espacios/disponibilidad')).toBe(DisponibilidadPage);
    expect(await componenteDe('/espacios')).toBe(EspaciosPage);
  });

  it('ninguna de las tres cae en el comodin', async () => {
    const urls = ['/espacios/nuevo', '/espacios/disponibilidad', '/espacios'];
    for (const url of urls) {
      expect(await componenteDe(url)).not.toBe(NotFound);
    }
  });

  it('un segmento inventado bajo /espacios si cae en el comodin', async () => {
    expect(await componenteDe('/espacios/inventado')).toBe(NotFound);
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
