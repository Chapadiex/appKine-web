import { Routes } from '@angular/router';

import {
  PERMISO_AUDITORIA_READ,
  PERMISO_COLABORADOR_MANAGE,
  PERMISO_COLABORADOR_READ,
  PERMISO_CONSULTORIO_MANAGE,
} from '../../core/models/permisos';
import { permissionGuard } from '../../core/guards/permission.guard';
import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';

/**
 * Las tres pantallas de tabla piden `ancho: 'amplio'` al layout raiz.
 *
 * <p>Con los 46rem de lectura la tabla de colaboradores desborda 101 px y esconde la
 * columna de acciones detras del scroll horizontal: los botones existen, pero para el
 * usuario no. El `max-width` vive en el `main` del shell, que es un ancestro, asi que la
 * pagina no puede ensancharse sola — tiene que pedirlo por la ruta.
 */

/**
 * Rutas de la feature `organization` (M01 y M05/M24, etapas AKINE-01.01 y 01.03).
 *
 * <p>Se monta bajo `organizacion` desde `app.routes.ts` con `loadChildren`, segun la
 * convencion de ADR-0004: cada dominio en su propio chunk, para que el bundle inicial no
 * crezca con cada uno de los 29 modulos.
 *
 * <p><b>`authGuard` y `contextGuard` los pone la ruta padre</b>, en `app.routes.ts`, y valen
 * para todas las de este archivo: los guards de una ruta padre corren antes que los de sus
 * hijas. Repetirlos aca solo agregaria ruido y dos lugares donde olvidarse de uno.
 *
 * <p><b>Las tres pantallas de 01.03 suman `permissionGuard`.</b> Se pide el permiso de
 * <b>lectura</b> y no el de gestion: quien solo puede mirar el listado tiene que poder
 * entrar y ver la tabla sin ninguna accion, que es lo que resuelve `*akinePermiso` adentro.
 * Exigir `colaborador:manage` en la ruta dejaria afuera a la mitad del publico de la
 * pantalla.
 *
 * <p><b>El alta si exige `colaborador:manage`</b>: es una pantalla que no tiene ningun
 * sentido en modo lectura — no hay nada que ver, solo un formulario que siempre iba a
 * terminar en `403`.
 *
 * <p>Los guards son UX: evitan una navegacion que se iba a llenar de errores. La autoridad es
 * el backend, que reevalua rol, grants, alcance y habilitacion en cada request y rechaza
 * igual a quien llegue por URL directa.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/organization/organization-page').then((m) => m.OrganizationPage),
    title: 'AKINE - Organizacion',
  },
  {
    path: 'suscripcion',
    loadComponent: () =>
      import('./pages/subscription/subscription-page').then((m) => m.SubscriptionPage),
    title: 'AKINE - Suscripcion',
  },

  // Alta antes que el listado: si `colaboradores/nuevo` quedara despues de `colaboradores`
  // seguiria funcionando -son paths distintos, no un parametro-, pero el orden explicito
  // evita que un futuro `colaboradores/:id` se coma esta ruta sin que nadie lo note.
  {
    path: 'colaboradores/nuevo',
    canActivate: [permissionGuard(PERMISO_COLABORADOR_MANAGE)],
    loadComponent: () =>
      import('./pages/new-collaborator/new-collaborator-page').then((m) => m.NewCollaboratorPage),
    title: 'AKINE - Vincular colaborador',
  },
  {
    path: 'colaboradores',
    canActivate: [permissionGuard(PERMISO_COLABORADOR_READ)],
    loadComponent: () =>
      import('./pages/collaborators/collaborators-page').then((m) => m.CollaboratorsPage),
    title: 'AKINE - Colaboradores',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  // Sedes (AKINE-02.01). Mismo orden que colaboradores: el alta antes que el listado.
  //
  // El alta exige `consultorio:manage`, que es lo que pide el endpoint. El LISTADO NO lleva
  // permissionGuard y no es un olvido: `GET .../consultorios` solo exige ser miembro vigente
  // del tenant, porque es la misma lectura que necesita el selector de contexto de trabajo.
  // Exigir `consultorio:manage` para mirar la tabla dejaria afuera a todo profesional que
  // solo quiere saber en que sedes trabaja el centro. Las acciones de cada fila si van detras
  // de `*akinePermiso`.
  {
    path: 'sedes/nueva',
    canActivate: [permissionGuard(PERMISO_CONSULTORIO_MANAGE)],
    loadComponent: () =>
      import('./pages/new-consultorio/new-consultorio-page').then((m) => m.NewConsultorioPage),
    title: 'AKINE - Abrir una sede',
  },
  {
    path: 'sedes',
    loadComponent: () =>
      import('./pages/consultorios/consultorios-page').then((m) => m.ConsultoriosPage),
    title: 'AKINE - Sedes',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: 'auditoria',
    canActivate: [permissionGuard(PERMISO_AUDITORIA_READ)],
    loadComponent: () => import('./pages/audit/audit-page').then((m) => m.AuditPage),
    title: 'AKINE - Auditoria',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
];
