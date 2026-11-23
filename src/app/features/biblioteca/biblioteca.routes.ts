import { Routes } from '@angular/router';

import { funcionIaGuard } from '../../core/guards/funcion-ia.guard';
import { permissionGuard } from '../../core/guards/permission.guard';
import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { PERMISO_BIBLIOTECA_MANAGE } from '../../core/models/permisos';

/**
 * Rutas de la feature `biblioteca` (libros PDF del centro y su busqueda).
 *
 * <p>Se monta bajo `biblioteca` desde `app.routes.ts`; `authGuard` y `contextGuard` los pone la
 * ruta padre. Las dos rutas llevan `permissionGuard(biblioteca:manage)`, que es UX: la autoridad
 * es el backend. No hay `:orgId` en la URL, la organizacion es la del contexto.
 */
export const routes: Routes = [
  {
    path: '',
    canActivate: [permissionGuard(PERMISO_BIBLIOTECA_MANAGE), funcionIaGuard('BIBLIOTECA')],
    loadComponent: () => import('./pages/biblioteca/biblioteca-page').then((m) => m.BibliotecaPage),
    title: 'AKINE - Bibliografía de la IA',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  // La pantalla de detalle se fue (23/11/2026): el libro se despliega en su fila de la lista.
  {
    path: ':libroId',
    redirectTo: ({ params }) => `/biblioteca?libro=${params['libroId']}`,
  },
];
