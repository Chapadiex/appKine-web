import { Routes } from '@angular/router';

import { contextGuard } from '../../core/guards/context.guard';

/**
 * Rutas de la Historia Clinica, sus casos y sus planes (D-a, D-b, D-c; M09, M10, M11). Se montan
 * bajo `historia-clinica` desde `app.routes.ts`; `authGuard` lo pone la ruta padre.
 *
 * <h2>La URL es la de la persona</h2>
 *
 * <p>La historia se pide por persona (`/historias-clinicas/por-persona/{personaId}`): es como se
 * llega desde el padron o desde una atencion, y una persona sin historia todavia tiene una URL
 * valida —la pantalla ofrece abrirla—. Con el id de la historia en la URL, ese caso no tendria
 * donde mostrarse.
 *
 * <h2>Una visita, tres pantallas</h2>
 *
 * <p>La historia, un caso y su plan cuelgan del mismo marco ({@link VisitaClinicaPage}), que guarda
 * el motivo de acceso declarado mientras se navega entre ellos. HC ≠ Caso: cada uno tiene su
 * pantalla, pero son la misma visita a la misma persona, y el motivo no se pide tres veces.
 * <b>Nada clinico viaja en la URL</b>: solo identificadores.
 *
 * <h2>`contextGuard`, y sin `permissionGuard`</h2>
 *
 * <p>La relacion asistencial se evalua contra la sede del contexto, asi que sin contexto no hay
 * respuesta posible. No lleva guard de permiso: `hc:read` solo no alcanza —sin relacion hace falta
 * motivo—, y un guard daria la impresion contraria. La autoridad es el backend.
 */
export const routes: Routes = [
  {
    path: 'personas/:personaId',
    canActivate: [contextGuard],
    loadComponent: () =>
      import('./pages/visita-clinica/visita-clinica-page').then((m) => m.VisitaClinicaPage),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/historia-clinica/historia-clinica-page').then(
            (m) => m.HistoriaClinicaPage,
          ),
        title: 'AKINE - Historia clínica',
      },
      {
        path: 'casos/:casoId',
        loadComponent: () =>
          import('./casos/pages/caso-detalle-page').then((m) => m.CasoDetallePage),
        title: 'AKINE - Caso clínico',
      },
      {
        path: 'casos/:casoId/plan',
        loadComponent: () => import('./plan/plan-page').then((m) => m.PlanPage),
        title: 'AKINE - Plan de tratamiento',
      },
    ],
  },
];
