import { Routes } from '@angular/router';

/**
 * Cuenta propia (refactor de la cabecera global, 28/10/2026): las dos pantallas del menu del
 * perfil. `authGuard` lo pone `app.routes.ts`, y no llevan `contextGuard`: el menu tambien se ve
 * sin contexto elegido (un administrador de plataforma puede no tener ninguno), `/me` responde
 * sin contexto y el tema se guarda en el navegador.
 */
export const routes: Routes = [
  {
    path: 'perfil',
    loadComponent: () => import('./pages/mi-perfil/mi-perfil-page').then((m) => m.MiPerfilPage),
    title: 'AKINE - Mi perfil',
  },
  {
    path: 'preferencias',
    loadComponent: () =>
      import('./pages/preferencias/preferencias-page').then((m) => m.PreferenciasPage),
    title: 'AKINE - Preferencias',
  },
  { path: '', pathMatch: 'full', redirectTo: 'perfil' },
];
