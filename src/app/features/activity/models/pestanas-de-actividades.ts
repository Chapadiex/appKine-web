import { Signal, computed } from '@angular/core';

import {
  PERMISO_CLASE_READ,
  PERMISO_INSCRIPCION_READ,
  PERMISO_PRODUCTO_READ,
} from '../../../core/models/permisos';
import { PermissionsStore } from '../../../core/services/permissions.store';
import { Pestana } from '../../../shared/components/pestanas/pestanas';
import { RUTA_CLASES } from './rutas-de-clases';
import { RUTA_PRODUCTOS } from './rutas-de-pases';

/** `aria-label` de las pestanas de la seccion de actividades. */
export const ETIQUETA_PESTANAS_DE_ACTIVIDADES = 'Pantallas de actividades';

const CLASES: Pestana = { etiqueta: 'Clases', ruta: RUTA_CLASES };
const ASISTENCIA: Pestana = { etiqueta: 'Asistencia', ruta: '/asistencia' };
const PRODUCTOS: Pestana = { etiqueta: 'Productos de pack', ruta: RUTA_PRODUCTOS };

/**
 * Las tres pantallas hermanas de Actividades (rediseño 19/11/2026): clases, asistencia y productos
 * de pack, con las mismas etiquetas que la barra lateral. Cada pestaña lleva el permiso que exige
 * el `permissionGuard` de su ruta (`activity.routes.ts`, `asistencia.routes.ts`,
 * `pases.routes.ts`): una pestaña que lleva a un 403 es peor que no tenerla. Ocultarla es UX: el
 * backend rechaza igual.
 */
export function pestanasDeActividades(permisos: PermissionsStore): Signal<readonly Pestana[]> {
  return computed(() => [
    ...(permisos.tiene(PERMISO_CLASE_READ) ? [CLASES] : []),
    ...(permisos.tiene(PERMISO_INSCRIPCION_READ) ? [ASISTENCIA] : []),
    ...(permisos.tiene(PERMISO_PRODUCTO_READ) ? [PRODUCTOS] : []),
  ]);
}
