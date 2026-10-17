import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { PERMISO_INSCRIPCION_READ } from '../../core/models/permisos';
import { contextGuard } from '../../core/guards/context.guard';
import { permissionGuard } from '../../core/guards/permission.guard';

/**
 * Rutas de la asistencia de clases (F9, AKINE-08.03). Se montan bajo `/asistencia` desde
 * `app.routes.ts`; `authGuard` lo pone la ruta padre.
 *
 * <p>Las dos piden `inscripcion:read`, que es lo que el backend exige para ver a los
 * participantes: sin el no se puede tomar lista. El listado del dia sale ademas de la agenda
 * unificada (`turno:read`), cuyo 403 se traduce. Los guards son UX: el backend rechaza igual.
 */
export const routes: Routes = [
  {
    path: '',
    canActivate: [contextGuard, permissionGuard(PERMISO_INSCRIPCION_READ)],
    loadComponent: () =>
      import('./pages/clases-del-dia/clases-del-dia-page').then((m) => m.ClasesDelDiaPage),
    title: 'AKINE - Asistencia a clases',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: ':claseId',
    canActivate: [contextGuard, permissionGuard(PERMISO_INSCRIPCION_READ)],
    loadComponent: () =>
      import('./pages/asistencia-de-clase/asistencia-de-clase-page').then(
        (m) => m.AsistenciaDeClasePage,
      ),
    title: 'AKINE - Asistencia de la clase',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
];
