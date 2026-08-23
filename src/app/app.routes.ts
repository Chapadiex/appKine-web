import { Routes } from '@angular/router';

/**
 * Rutas raiz de AKINE (estructura fijada en AKINE-00.02).
 *
 * <p><b>Convencion para las features de M01-M29:</b> cada dominio se monta como una ruta
 * con `loadChildren` apuntando a su propio archivo de rutas, para que quede lazy loaded y
 * el bundle inicial no crezca con cada modulo (ADR-0004):
 *
 * <pre>
 * {
 *   path: 'pacientes',
 *   loadChildren: () =&gt; import('./features/person/person.routes').then(m =&gt; m.routes),
 *   canActivate: [authGuard, contextGuard],
 * }
 * </pre>
 *
 * <p>Los guards son UX: evitan una navegacion que va a fallar. La autoridad de permisos es
 * el backend, que rechaza igual si se llega por URL directa.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/platform/pages/estado/estado').then((m) => m.Estado),
    title: 'AKINE - Baseline tecnico',
  },

  // Seleccion del contexto de trabajo (M01). Va suelta y no bajo `organizacion` porque
  // logicamente precede a tener una: es la pantalla con la que se averigua cual.
  {
    path: 'seleccionar-contexto',
    loadComponent: () =>
      import('./features/organization/pages/context-selector/context-selector-page').then(
        (m) => m.ContextSelectorPage,
      ),
    title: 'AKINE - Elegir contexto',
  },

  // Feature `organization` (M01). Lazy loaded segun ADR-0004.
  //
  // Sin `canActivate`: los guards de sesion y contexto llegan en AKINE-01.02 junto con el
  // login. Un guard de contexto hoy redirigiria toda la aplicacion a una pantalla que sin
  // sesion no puede resolverse, y romperia la ruta baseline de `/`, que tiene E2E pasando.
  {
    path: 'organizacion',
    loadChildren: () =>
      import('./features/organization/organization.routes').then((m) => m.routes),
  },

  // Comodin al final: cualquier ruta desconocida cae aca.
  {
    path: '**',
    loadComponent: () => import('./shared/pages/not-found/not-found').then((m) => m.NotFound),
    title: 'AKINE - Pagina no encontrada',
  },
];
