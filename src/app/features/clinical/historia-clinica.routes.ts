import { Routes } from '@angular/router';

import { contextGuard } from '../../core/guards/context.guard';

/**
 * Rutas de la Historia Clinica (D-a, M09/M25). Se montan bajo `historia-clinica` desde
 * `app.routes.ts`; `authGuard` lo pone la ruta padre.
 *
 * <h2>La URL es la de la persona</h2>
 *
 * <p>La historia se pide por persona (`/historias-clinicas/por-persona/{personaId}`): es como se
 * llega desde el padron o desde una atencion, y una persona sin historia todavia tiene una URL
 * valida —la pantalla ofrece abrirla—. Con el id de la historia en la URL, ese caso no tendria
 * donde mostrarse.
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
      import('./pages/historia-clinica/historia-clinica-page').then((m) => m.HistoriaClinicaPage),
    title: 'AKINE - Historia clinica',
  },
];
