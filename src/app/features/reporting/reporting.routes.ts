import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { PERMISO_REPORTE_READ } from '../../core/models/permisos';
import { contextGuard } from '../../core/guards/context.guard';
import { permissionGuard } from '../../core/guards/permission.guard';

/**
 * Rutas de la feature `reporting` (M23, AKINE-07.06 y G-8). Se montan bajo `/reportes` desde
 * `app.routes.ts`; `authGuard` lo pone la ruta padre.
 *
 * <p>`permissionGuard(reporte:read)`: sin el permiso las tres operaciones del modulo responden
 * 403 (DP-15). El guard es UX: el backend rechaza igual y, ademas, recorta cada seccion por su
 * propio permiso.
 */
export const routes: Routes = [
  {
    path: '',
    canActivate: [contextGuard, permissionGuard(PERMISO_REPORTE_READ)],
    loadComponent: () => import('./pages/reportes/reportes-page').then((m) => m.ReportesPage),
    title: 'AKINE - Reportes',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
];
