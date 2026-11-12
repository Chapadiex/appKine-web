import { Routes } from '@angular/router';

import { permissionGuard } from '../../core/guards/permission.guard';
import { PERMISO_BIBLIOTECA_CONSULTAR } from '../../core/models/permisos';

/**
 * Rutas de la consulta a la biblioteca con el asistente.
 *
 * <p>Se monta bajo `consulta` desde `app.routes.ts`; `authGuard` y `contextGuard` los pone la ruta
 * padre. El guard es UX: la autoridad es el backend.
 */
export const routes: Routes = [
  {
    path: '',
    canActivate: [permissionGuard(PERMISO_BIBLIOTECA_CONSULTAR)],
    loadComponent: () => import('./pages/consulta/consulta-page').then((m) => m.ConsultaPage),
    title: 'AKINE - Consultar biblioteca',
  },
];
