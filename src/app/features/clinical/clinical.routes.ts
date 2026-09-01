import { Routes } from '@angular/router';

import { contextGuard } from '../../core/guards/context.guard';

/**
 * Rutas de la feature `clinical` (atencion clinica, M14, AKINE-06.01 y 06.02).
 *
 * <p>Se monta bajo `atencion` desde `app.routes.ts` con `loadChildren`, segun ADR-0004.
 * <b>`authGuard` lo pone la ruta padre.</b>
 *
 * <h2>La URL es la del turno, y no la de la sesion</h2>
 *
 * <p>Iniciar la atencion es <b>idempotente</b>: si ya habia una sesion abierta el backend devuelve
 * esa. Con la URL apuntando al turno, recargar la pantalla vuelve a la misma atencion sin que el
 * frontend tenga que recordar ningun id ni distinguir "abrir" de "retomar", que es exactamente la
 * distincion que el contrato se propuso evitarle (RN-M14-001: un turno produce como mucho una
 * sesion).
 *
 * <h2>`contextGuard`, y sin `permissionGuard`</h2>
 *
 * <p>La atencion es de una <b>sede</b>: sin ella no hay ni siquiera una URL que armar
 * —`/consultorios/{id}/sesiones/...`—, asi que mandar al selector una vez es preferible a abrir
 * una pantalla que no puede pedir nada.
 *
 * <p><b>No lleva `permissionGuard`.</b> `sesion:register` no basta para escribir en una atencion:
 * la sesion es de <b>quien la lleva</b>, y el backend rechaza a cualquier otro con 409
 * `sesion-ajena` aunque tenga el permiso. Un guard de permiso daria la impresion contraria —que
 * quien pasa puede escribir— y dejaria afuera igual a nadie util. La autoridad es el backend.
 *
 * <h2>Sin ruta de cierre y sin Historia Clinica</h2>
 *
 * <p>AKINE-06.05 no existe todavia y la HC no tiene endpoints. Montar rutas para ellas seria
 * prometer pantallas que terminan en un 404.
 */
export const routes: Routes = [
  {
    path: 'turnos/:turnoId',
    canActivate: [contextGuard],
    loadComponent: () => import('./pages/atencion/atencion-page').then((m) => m.AtencionPage),
    title: 'AKINE - Atencion clinica',
  },
];
