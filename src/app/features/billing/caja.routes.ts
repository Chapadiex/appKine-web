import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { PERMISO_CAJA_OPERATE } from '../../core/models/permisos';
import { contextGuard } from '../../core/guards/context.guard';
import { permissionGuard } from '../../core/guards/permission.guard';

/**
 * Rutas de la caja diaria (M20, AKINE-07.03). Se monta bajo `caja` desde `app.routes.ts` con
 * `loadChildren`, segun ADR-0004. <b>`authGuard` lo pone la ruta padre.</b>
 *
 * <p>Archivo propio y no dentro de `billing.routes.ts`: esas rutas cuelgan de
 * `pacientes/:personaId/cuenta-corriente` porque no se llega sin una persona, y la caja es de la
 * <b>sede</b>, no de nadie. Misma feature, otra raiz.
 *
 * <p><b>Lleva `permissionGuard`</b>, como `cobrar`: todo lo que hay en la pantalla —incluso leer
 * la jornada— lo autoriza `caja:operate`, asi que sin el permiso no queda nada que mirar. Sigue
 * sin ser seguridad: el backend reevalua el permiso contra la sede en cada request.
 */
export const routes: Routes = [
  {
    path: '',
    canActivate: [contextGuard, permissionGuard(PERMISO_CAJA_OPERATE)],
    loadComponent: () => import('./pages/caja/caja-page').then((m) => m.CajaPage),
    title: 'AKINE - Caja diaria',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
];
