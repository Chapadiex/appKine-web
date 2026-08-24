import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';
import { contextGuard } from './core/guards/context.guard';

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

  // Feature `auth` (M02). Lazy loaded segun ADR-0004.
  //
  // Sin `canActivate`: son las unicas pantallas que un usuario anonimo tiene que poder
  // abrir. Los enlaces de los correos entran por `auth/activar` y `auth/restablecer`.
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes').then((m) => m.routes),
  },

  // Seleccion del contexto de trabajo (M01). Va suelta y no bajo `organizacion` porque
  // logicamente precede a tener una: es la pantalla con la que se averigua cual.
  //
  // Lleva `authGuard` pero NO `contextGuard`: es justamente la pantalla donde se elige el
  // contexto, y exigirle tener uno la volveria inalcanzable.
  {
    path: 'seleccionar-contexto',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/organization/pages/context-selector/context-selector-page').then(
        (m) => m.ContextSelectorPage,
      ),
    title: 'AKINE - Elegir contexto',
  },

  // Feature `organization` (M01). Lazy loaded segun ADR-0004.
  //
  // Los dos guards, en este orden: sin sesion no tiene sentido preguntar por el contexto.
  // Son UX y no seguridad —el backend rechaza igual si se llega por URL directa—, pero sin
  // ellos estas pantallas se abren vacias y muestran un 403 en vez de mandar a resolverlo.
  {
    path: 'organizacion',
    canActivate: [authGuard, contextGuard],
    loadChildren: () => import('./features/organization/organization.routes').then((m) => m.routes),
  },

  // Pantalla de permiso insuficiente (AKINE-01.03). Es el destino de `permissionGuard`.
  //
  // Sin guards, y no por descuido: quien llega aca YA paso por `authGuard` y `contextGuard`
  // en la ruta que se le nego, asi que tiene sesion y contexto. Ponerle un `authGuard` seria
  // ademas peligroso el dia que algo redirija aca sin sesion: el usuario rebotaria al login,
  // volveria a la URL original y giraria en el mismo bucle que esta pantalla existe para
  // cortar. La constante que la nombra vive en `core/models/rutas.ts` (RUTA_SIN_PERMISO).
  {
    path: 'sin-permiso',
    loadComponent: () => import('./shared/pages/sin-permiso/sin-permiso').then((m) => m.SinPermiso),
    title: 'AKINE - Sin permiso',
  },

  // Comodin al final: cualquier ruta desconocida cae aca.
  {
    path: '**',
    loadComponent: () => import('./shared/pages/not-found/not-found').then((m) => m.NotFound),
    title: 'AKINE - Pagina no encontrada',
  },
];
