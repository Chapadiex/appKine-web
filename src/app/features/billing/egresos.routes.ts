import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { PERMISO_CAJA_OPERATE } from '../../core/models/permisos';
import { contextGuard } from '../../core/guards/context.guard';
import { permissionGuard } from '../../core/guards/permission.guard';

/**
 * Rutas de los egresos y sus pagos (M22, AKINE-07.05, paquete F-5), dentro de la feature
 * `billing`. Se montan bajo `/egresos` desde `app.routes.ts`; `authGuard` lo pone la ruta padre.
 *
 * <p>Archivo propio por lo mismo que `caja.routes.ts` y `presentaciones.routes.ts`: un egreso es
 * de la SEDE, no de un paciente.
 *
 * <p><b>`permissionGuard(caja:operate)`</b> porque es el permiso que el backend exige para las
 * ocho operaciones de M22 (§11 del diseno de 07.05; DU-10 discute si merece `egreso:manage`
 * propio). Si el backend lo cambia, cambia esta constante y la del menu. El guard es UX: el
 * backend rechaza igual.
 */
export const routes: Routes = [
  {
    path: '',
    canActivate: [contextGuard, permissionGuard(PERMISO_CAJA_OPERATE)],
    loadComponent: () => import('./pages/egresos/egresos-page').then((m) => m.EgresosPage),
    title: 'AKINE - Egresos',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    // Liquidacion de honorarios por clase (DP-38, RF-M22-006/007). Vive bajo /egresos porque lo
    // que produce es un egreso, y pide el mismo `caja:operate`. Va ANTES de `:egresoId`: si no,
    // "honorarios" se tomaria por el id de un egreso.
    path: 'honorarios',
    canActivate: [contextGuard, permissionGuard(PERMISO_CAJA_OPERATE)],
    loadComponent: () =>
      import('./pages/liquidacion-de-honorarios/liquidacion-de-honorarios-page').then(
        (m) => m.LiquidacionDeHonorariosPage,
      ),
    title: 'AKINE - Liquidar honorarios por clase',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: 'honorarios/liquidaciones/:liquidacionId',
    canActivate: [contextGuard, permissionGuard(PERMISO_CAJA_OPERATE)],
    loadComponent: () =>
      import('./pages/liquidacion-detalle/liquidacion-detalle-page').then(
        (m) => m.LiquidacionDetallePage,
      ),
    title: 'AKINE - Liquidacion de honorarios',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: ':egresoId',
    canActivate: [contextGuard, permissionGuard(PERMISO_CAJA_OPERATE)],
    loadComponent: () =>
      import('./pages/egreso-detalle/egreso-detalle-page').then((m) => m.EgresoDetallePage),
    title: 'AKINE - Egreso',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
];
