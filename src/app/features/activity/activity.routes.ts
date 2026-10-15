import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { PERMISO_CLASE_MANAGE, PERMISO_CLASE_READ } from '../../core/models/permisos';
import { contextGuard } from '../../core/guards/context.guard';
import { permissionGuard } from '../../core/guards/permission.guard';
import { SEGMENTO_NUEVA_CLASE } from './models/rutas-de-clases';

/**
 * Rutas de la feature `activity` (M28 y M29, segunda entrega). Se montan bajo `/clases` desde
 * `app.routes.ts`; `authGuard` lo pone la ruta padre.
 *
 * <p>Todas llevan `contextGuard`: una clase es de una SEDE. Y `permissionGuard` con el permiso de
 * la operacion que la pantalla abre: `clase:read` para mirar, `clase:manage` para programar. Los
 * participantes piden ademas `inscripcion:read`, que la pantalla de detalle resuelve por seccion
 * —la clase y sus cupos se ven sin el—. Los guards son UX: el backend rechaza igual.
 *
 * <p>Las pantallas de asistencia, pases y abonos (08.03 en adelante) se agregan aca, como hijas de
 * `:claseId` o con segmento propio. `nueva` va antes que `:claseId` para que no la tome como id.
 */
export const routes: Routes = [
  {
    path: '',
    canActivate: [contextGuard, permissionGuard(PERMISO_CLASE_READ)],
    loadComponent: () =>
      import('./pages/clases-de-la-semana/clases-de-la-semana-page').then(
        (m) => m.ClasesDeLaSemanaPage,
      ),
    title: 'AKINE - Clases',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: SEGMENTO_NUEVA_CLASE,
    canActivate: [contextGuard, permissionGuard(PERMISO_CLASE_MANAGE)],
    loadComponent: () =>
      import('./pages/alta-de-clase/alta-de-clase-page').then((m) => m.AltaDeClasePage),
    title: 'AKINE - Programar clase',
  },
  {
    path: ':claseId',
    canActivate: [contextGuard, permissionGuard(PERMISO_CLASE_READ)],
    loadComponent: () =>
      import('./pages/detalle-de-clase/detalle-de-clase-page').then((m) => m.DetalleDeClasePage),
    title: 'AKINE - Clase',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
];
