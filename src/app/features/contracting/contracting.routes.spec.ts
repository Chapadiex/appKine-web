import { ActivatedRouteSnapshot, Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { Type } from '@angular/core';

import { ArancelEfectivoPage } from './pages/arancel-efectivo/arancel-efectivo-page';
import { ArancelesDelConvenioPage } from './pages/aranceles-del-convenio/aranceles-del-convenio-page';
import { ConveniosDeLaSedePage } from './pages/convenios-de-la-sede/convenios-de-la-sede-page';
import { FinanciadoresPage } from './pages/financiadores/financiadores-page';
import { ImportarArancelesPage } from './pages/importar-aranceles/importar-aranceles-page';
import { NotFound } from '../../shared/pages/not-found/not-found';
import { PermissionsStore } from '../../core/services/permissions.store';
import { PlanesDelFinanciadorPage } from './pages/planes-del-financiador/planes-del-financiador-page';
import { SessionService } from '../../core/services/session.service';
import { RUTA_SIN_PERMISO } from '../../core/models/rutas';
import { PERMISO_CONVENIO_READ, PERMISO_CONVENIO_MANAGE } from '../../core/models/permisos';
import { routes as rutasDeLaApp } from '../../app.routes';

/**
 * Pineo de los prefijos de ruta de `/contratacion` (M15 y M16).
 *
 * <p>Misma forma que el spec de `/catalogo`: navega de verdad contra `app.routes.ts` y comprueba a
 * que componente llega cada URL, sin confiar en que el path escrito en `contracting.routes.ts` siga
 * coincidiendo con lo que enlaza cada plantilla.
 *
 * <p>Aca importa mas que en otras features: son <b>cinco</b> pantallas que se enlazan entre si con
 * `routerLink` literales —cada una tiene la barra de navegacion de las otras— y dos de ellas
 * cuelgan de un id. Un prefijo que se mueva sin que esos enlaces se muevan con el <b>no rompe la
 * compilacion</b>: deja al usuario en el 404 del comodin.
 */
const TODOS = new Set<string>([PERMISO_CONVENIO_READ, PERMISO_CONVENIO_MANAGE]);
let concedidos: ReadonlySet<string> = TODOS;

describe('Rutas de /contratacion', () => {
  let router: Router;

  beforeEach(() => {
    concedidos = TODOS;
    TestBed.configureTestingModule({
      providers: [
        provideRouter(rutasDeLaApp),
        { provide: SessionService, useValue: { estado: () => 'activa', restaurando: () => false } },
        {
          provide: PermissionsStore,
          useValue: {
            cargados: () => true,
            tieneAlguno: (...pedidos: string[]) => pedidos.some((p) => concedidos.has(p)),
            tiene: (p: string) => concedidos.has(p),
          },
        },
      ],
    });

    router = TestBed.inject(Router);
  });

  it('/contratacion a secas cae en los convenios de la sede', async () => {
    // Y no en el catalogo de financiadores: el convenio es lo que vence, se renueva y cambia de
    // precio, y es la unica de las cinco que es de la SEDE, que es donde esta parado quien abre
    // el menu principal.
    expect(await componenteDe('/contratacion')).toBe(ConveniosDeLaSedePage);
  });

  it('cada una de las cinco rutas resuelve a su pantalla', async () => {
    expect(await componenteDe('/contratacion/financiadores')).toBe(FinanciadoresPage);
    expect(await componenteDe('/contratacion/financiadores/10/planes')).toBe(
      PlanesDelFinanciadorPage,
    );
    expect(await componenteDe('/contratacion/convenios')).toBe(ConveniosDeLaSedePage);
    expect(await componenteDe('/contratacion/convenios/7/aranceles')).toBe(
      ArancelesDelConvenioPage,
    );
    expect(await componenteDe('/contratacion/convenios/7/aranceles/importar')).toBe(
      ImportarArancelesPage,
    );
    expect(await componenteDe('/contratacion/arancel-efectivo')).toBe(ArancelEfectivoPage);
  });

  it('ninguna de las seis URLs cae en el comodin', async () => {
    const urls = [
      '/contratacion',
      '/contratacion/financiadores',
      '/contratacion/financiadores/10/planes',
      '/contratacion/convenios',
      '/contratacion/convenios/7/aranceles',
      '/contratacion/arancel-efectivo',
    ];
    for (const url of urls) {
      expect(await componenteDe(url)).not.toBe(NotFound);
    }
  });

  it('sin convenio:read ninguna de las seis pantallas abre, aunque tenga convenio:manage (DP-36)', async () => {
    concedidos = new Set([PERMISO_CONVENIO_MANAGE]);
    for (const url of [
      '/contratacion/financiadores',
      '/contratacion/financiadores/10/planes',
      '/contratacion/convenios',
      '/contratacion/convenios/7/aranceles',
      '/contratacion/convenios/7/aranceles/importar',
      '/contratacion/arancel-efectivo',
    ]) {
      await router.navigateByUrl(url);
      expect(router.url).toBe(RUTA_SIN_PERMISO);
    }
  });

  it('una URL inventada bajo el prefijo si cae en el comodin', async () => {
    // El test negativo real: prueba que el comodin sigue alcanzable y que los anteriores no pasan
    // porque `componenteDe` este roto. A diferencia de `catalog`, esta feature no tiene ninguna
    // ruta catch-all de un segmento.
    expect(await componenteDe('/contratacion/inventado')).toBe(NotFound);
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
