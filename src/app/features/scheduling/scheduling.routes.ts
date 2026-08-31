import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { contextGuard } from '../../core/guards/context.guard';

/**
 * Rutas de la feature `scheduling` (agenda y reserva de turnos, M12, AKINE-05.01 y 05.02).
 *
 * <p>Se monta bajo `agenda` desde `app.routes.ts` con `loadChildren`, segun ADR-0004.
 * <b>`authGuard` lo pone la ruta padre.</b>
 *
 * <h2>`contextGuard` en las dos, y con sede</h2>
 *
 * <p>La agenda es de una <b>sede</b>: la oferta cuelga del consultorio y los permisos `turno:read`
 * y `turno:manage` se evaluan con la sede del contexto. Sin ella no hay ni siquiera una URL que
 * armar —`/consultorios/{id}/ofertas/...`—, asi que mandar al selector una vez es preferible a
 * abrir una pantalla que no puede pedir nada.
 *
 * <p><b>No lleva `permissionGuard`.</b> Consultar la agenda es lo que hace cualquiera que atienda
 * el mostrador; las acciones van detras del permiso, que es UX. La autoridad sigue siendo el
 * backend, que rechaza igual si se llega por URL directa.
 *
 * <h2>La reserva es una ruta propia y no un panel</h2>
 *
 * <p>Podria haber sido un panel dentro de la grilla, y seria peor: reservar crea algo que
 * <b>no se puede cancelar</b> —AKINE-05.03 quedo fuera de alcance por DP-10— y el resumen previo
 * es lo unico que hay entre un click y un turno equivocado. Una URL propia ademas sobrevive a un
 * refresh y se puede compartir con quien tiene que revisarla.
 *
 * <p>El slot elegido viaja en la query (`fecha`, `inicio`, `profesionalId`) y no en el estado de
 * navegacion: el estado se pierde al recargar y dejaria la pantalla sin saber que reservar.
 */
export const routes: Routes = [
  {
    path: '',
    canActivate: [contextGuard],
    loadComponent: () =>
      import('./pages/buscador-de-agenda/buscador-de-agenda-page').then(
        (m) => m.BuscadorDeAgendaPage,
      ),
    title: 'AKINE - Agenda de turnos',
    // Ancho amplio: la grilla pone los slots de un dia en una fila y a 46rem una jornada de
    // ocho horas queda detras del scroll horizontal.
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: 'ofertas/:ofertaId/reservar',
    canActivate: [contextGuard],
    loadComponent: () =>
      import('./pages/reserva-de-turno/reserva-de-turno-page').then((m) => m.ReservaDeTurnoPage),
    title: 'AKINE - Reservar un turno',
  },
];
