import { Routes } from '@angular/router';

import { permissionGuard } from '../../core/guards/permission.guard';
import { PERMISO_ASISTENTE_USE } from '../../core/models/permisos';

/**
 * Rutas del asistente de datos. Se monta bajo `asistente` desde `app.routes.ts`; `authGuard` y
 * `contextGuard` los pone la ruta padre. El guard es UX: la autoridad es el backend.
 */
export const routes: Routes = [
  {
    path: '',
    canActivate: [permissionGuard(PERMISO_ASISTENTE_USE)],
    loadComponent: () => import('./pages/asistente/asistente-page').then((m) => m.AsistentePage),
    title: 'AKINE - Asistente de datos',
  },
];
