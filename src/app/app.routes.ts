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

  // Comodin al final: cualquier ruta desconocida cae aca.
  {
    path: '**',
    loadComponent: () => import('./shared/pages/not-found/not-found').then((m) => m.NotFound),
    title: 'AKINE - Pagina no encontrada',
  },
];
