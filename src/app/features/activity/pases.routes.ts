import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { PERMISO_PASE_READ, PERMISO_PRODUCTO_READ } from '../../core/models/permisos';
import { contextGuard } from '../../core/guards/context.guard';
import { permissionGuard } from '../../core/guards/permission.guard';

/**
 * Rutas de pases y productos de pack (F9, M29, AKINE-08.06). `authGuard` lo pone la ruta padre de
 * `app.routes.ts`.
 *
 * <p>Las dos llevan `contextGuard`: un producto y un pase son de una SEDE. `pase:read` para ver los
 * pases de una persona y `producto:read` para el catalogo; vender y editar los resuelve la
 * pantalla con `pase:manage` y `producto:manage`. Los guards son UX: el backend rechaza igual.
 */

/** Se monta bajo `pacientes/:personaId/pases`, ANTES que `pacientes` (ver `app.routes.ts`). */
export const rutasPasesDePersona: Routes = [
  {
    path: '',
    canActivate: [contextGuard, permissionGuard(PERMISO_PASE_READ)],
    loadComponent: () =>
      import('./pages/pases-de-persona/pases-de-persona-page').then((m) => m.PasesDePersonaPage),
    title: 'AKINE - Pases de la persona',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
];

/** Se monta bajo `/productos`. */
export const rutasProductos: Routes = [
  {
    path: '',
    canActivate: [contextGuard, permissionGuard(PERMISO_PRODUCTO_READ)],
    loadComponent: () =>
      import('./pages/productos-de-pack/productos-de-pack-page').then((m) => m.ProductosDePackPage),
    title: 'AKINE - Productos de pack y abonos',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
];
