import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { PERMISO_COBRO_REGISTER } from '../../core/models/permisos';
import { contextGuard } from '../../core/guards/context.guard';
import { permissionGuard } from '../../core/guards/permission.guard';

/**
 * Rutas de las presentaciones a financiadores (M21, AKINE-07.04), dentro de la feature `billing`.
 *
 * <p>Se montan bajo `/presentaciones` desde `app.routes.ts` con `loadChildren`; `authGuard` lo
 * pone la ruta padre. Es un archivo de rutas aparte de `billing.routes.ts` porque aquel cuelga de
 * `pacientes/:personaId/cuenta-corriente` y una presentacion no es de un paciente: es de una sede
 * y un financiador.
 *
 * <p><b>`permissionGuard(cobro:register)` en las dos</b>, a diferencia de la cuenta corriente:
 * aca se llega desde una seccion del menu, no desde un enlace que ya estaba detras de
 * `*akinePermiso`, y sin el permiso cada operacion de la pantalla responde 403. El permiso es
 * `cobro:register` y no uno propio porque asi lo decidio el backend (§12 del diseno de 07.04). El
 * guard es UX: el backend rechaza igual.
 */
export const routes: Routes = [
  {
    path: '',
    canActivate: [contextGuard, permissionGuard(PERMISO_COBRO_REGISTER)],
    loadComponent: () =>
      import('./pages/presentaciones/presentaciones-page').then((m) => m.PresentacionesPage),
    title: 'AKINE - Presentaciones a financiadores',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: ':presentacionId',
    canActivate: [contextGuard, permissionGuard(PERMISO_COBRO_REGISTER)],
    loadComponent: () =>
      import('./pages/presentacion-detalle/presentacion-detalle-page').then(
        (m) => m.PresentacionDetallePage,
      ),
    title: 'AKINE - Lote de presentacion',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
];
