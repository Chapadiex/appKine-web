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
 * <h2>El cierre no tiene ruta propia, y eso es deliberado</h2>
 *
 * <p>Cerrar (AKINE-06.05) es el ultimo paso de la <b>misma</b> pantalla y no una pantalla aparte:
 * lo que se cierra es lo que se acaba de cargar, y mandarlo a otra URL obligaria a releer la
 * sesion para volver a mostrar lo mismo. Despues del cierre esa URL sigue siendo la correcta:
 * abrirla devuelve la atencion cerrada, en modo lectura.
 *
 * <h2>Enmienda y versiones (AKINE-06.06): por sesion, y no por turno</h2>
 *
 * <p>Lo que se corrige es una <b>sesion cerrada</b>, que ya existe y tiene id: no hay nada que
 * iniciar, asi que la URL es la de la sesion. Lleva solo el id —ningun dato clinico viaja en la
 * URL— y la pantalla lee el resto. Las dos llevan `contextGuard` por lo mismo que la atencion,
 * y tampoco `permissionGuard`: enmendar la sesion ajena es 409 `sesion-ajena`, no 403.
 */
export const routes: Routes = [
  {
    path: 'turnos/:turnoId',
    canActivate: [contextGuard],
    loadComponent: () => import('./pages/atencion/atencion-page').then((m) => m.AtencionPage),
    title: 'AKINE - Atencion clinica',
  },
  {
    path: 'sesiones/:sesionId/enmienda',
    canActivate: [contextGuard],
    loadComponent: () => import('./pages/enmienda/enmienda-page').then((m) => m.EnmiendaPage),
    title: 'AKINE - Enmendar una atencion',
  },
  {
    path: 'sesiones/:sesionId/versiones',
    canActivate: [contextGuard],
    loadComponent: () => import('./pages/versiones/versiones-page').then((m) => m.VersionesPage),
    title: 'AKINE - Versiones de una atencion',
  },
];
