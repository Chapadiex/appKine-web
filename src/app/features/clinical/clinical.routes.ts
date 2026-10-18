import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { contextGuard } from '../../core/guards/context.guard';
import { permissionGuard } from '../../core/guards/permission.guard';
import { PERMISO_INSCRIPCION_READ, PERMISO_SESION_REGISTER } from '../../core/models/permisos';

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
 * <p><b>No lleva `permissionGuard`</b> (salvo el panel de la clase, ver su ruta). `sesion:register` no basta para escribir en una atencion:
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
    // Atencion de un participante de una clase (AKINE-08.05): ya existe —la abrio el panel de la
    // clase— y se abre por su id. Misma pantalla que la del turno.
    path: 'sesiones/:sesionId',
    canActivate: [contextGuard],
    loadComponent: () => import('./pages/atencion/atencion-page').then((m) => m.AtencionPage),
    title: 'AKINE - Atencion clinica',
  },
  {
    // Panel de atencion clinica de una clase (AKINE-08.05): una atencion por participante y Caso.
    //
    // A diferencia de la atencion individual, ESTE si lleva `permissionGuard` (AKINE-09.02). La
    // atencion de un turno ya existe y es de alguien: ahi el rechazo es 409 `sesion-ajena`, no un
    // problema de permiso. El panel, en cambio, no tiene otra funcion que ABRIR atenciones, y abrir
    // una pide `sesion:register`, que la matriz §32 da solo al PROFESIONAL. Un ADMINISTRATIVO —que
    // tiene `inscripcion:read`, y por eso el backend le deja leer el panel— entraba a una pantalla
    // donde cada boton terminaba en 403. Son dos guards porque cada uno es OR y hacen falta los
    // dos: `sesion:register` para abrir e `inscripcion:read` para leer la clase.
    path: 'clases/:claseId',
    canActivate: [
      contextGuard,
      permissionGuard(PERMISO_SESION_REGISTER),
      permissionGuard(PERMISO_INSCRIPCION_READ),
    ],
    loadComponent: () =>
      import('./pages/atencion-grupal/atencion-grupal-page').then((m) => m.AtencionGrupalPage),
    title: 'AKINE - Atencion clinica de la clase',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
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
