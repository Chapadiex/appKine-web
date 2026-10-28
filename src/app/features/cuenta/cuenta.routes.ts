import { Routes } from '@angular/router';

import { contextGuard } from '../../core/guards/context.guard';

/**
 * Cuenta propia (refactor de la cabecera global, 28/10/2026): las dos pantallas del menu del
 * perfil. `authGuard` lo pone `app.routes.ts`; `contextGuard` va aca porque el shell solo dibuja
 * la barra superior —y con ella el menu que lleva a estas pantallas— con un contexto elegido.
 */
export const routes: Routes = [
  {
    path: 'perfil',
    canActivate: [contextGuard],
    loadComponent: () => import('./pages/mi-perfil/mi-perfil-page').then((m) => m.MiPerfilPage),
    title: 'AKINE - Mi perfil',
  },
  {
    path: 'preferencias',
    canActivate: [contextGuard],
    loadComponent: () =>
      import('./pages/preferencias/preferencias-page').then((m) => m.PreferenciasPage),
    title: 'AKINE - Preferencias',
  },
  { path: '', pathMatch: 'full', redirectTo: 'perfil' },
];
