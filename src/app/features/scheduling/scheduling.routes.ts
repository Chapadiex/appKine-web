import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { PERMISO_TURNO_READ } from '../../core/models/permisos';
import { contextGuard } from '../../core/guards/context.guard';
import { permissionGuard } from '../../core/guards/permission.guard';

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
 * <p>Podria haber sido un panel dentro de la grilla, y seria peor: el resumen previo es lo unico
 * que hay entre un click y un turno equivocado en la agenda de un profesional. Una URL propia
 * ademas sobrevive a un refresh y se puede compartir con quien tiene que revisarla.
 *
 * <h2>La recepcion del dia es una cuarta ruta, y lleva `permissionGuard` (AKINE-05.04)</h2>
 *
 * <p><b>Con `turno:read`</b>, que es lo que el backend exige para `GET /turnos?fecha=`: mirar quien
 * viene hoy es leer la agenda, no operarla. Las dos acciones de llegada piden `turno:manage` y se
 * esconden <b>dentro</b> de la pantalla, igual que en el ciclo del turno — un guard con el permiso
 * de gestion dejaria afuera a quien solo quiere ver la lista, que es exactamente lo que el backend
 * si le permite.
 *
 * <p>A diferencia de la agenda, esta lleva guard: la agenda se abre sin el porque su ruta vacia no
 * pide nada al servidor hasta que se elige una oferta, y esta pide la lista del dia al abrirse.
 * Sigue siendo UX y no seguridad — el backend rechaza igual por URL directa.
 *
 * <p><b>Es una pantalla propia y no una pestaña del buscador</b>, y no es cosmetico: el buscador
 * responde "cuando hay lugar para reservar" y la recepcion responde "quien viene hoy". Son dos
 * lecturas distintas, con dos endpoints distintos y dos momentos del dia distintos.
 *
 * <p>La fecha viaja en la query (`?fecha=`) para que un refresh —o un enlace copiado— vuelva al
 * mismo dia.
 *
 * <h2>El ciclo del turno es una tercera ruta, y lleva `permissionGuard` (AKINE-05.03)</h2>
 *
 * <p><b>Con `turno:read` y no con `turno:manage`</b>, que es lo que exige el historial: leer quien
 * cancelo y por que es parte de mirar la agenda, no de operarla. Las cuatro transiciones piden
 * `turno:manage` y esas se esconden <b>dentro</b> de la pantalla, que es donde la distincion es
 * util: un guard con el permiso de gestion dejaria afuera a quien solo quiere consultar el
 * historial, que es exactamente lo que el backend si le permite.
 *
 * <p>Es la unica de las tres con guard de permiso, y no es una incoherencia: las otras dos se
 * abren sin el porque consultar la agenda es lo que hace cualquiera que atienda el mostrador.
 * Sigue siendo UX y no seguridad — la autoridad es el backend, que rechaza igual por URL directa.
 *
 * <p><b>La version del turno viaja en la query</b> (`?version=`), junto con `ofertaId` y `fecha`.
 * No es elegante y es lo unico posible: el contrato 0.21.0 no publica ninguna lectura de un turno,
 * asi que la pantalla no tiene de donde sacar la version que las transiciones exigen. Sin esos
 * datos la ruta abre igual y queda en modo lectura; el detalle esta en `pages/ciclo-de-turno`.
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
  {
    path: 'recepcion',
    canActivate: [contextGuard, permissionGuard(PERMISO_TURNO_READ)],
    loadComponent: () =>
      import('./pages/recepcion-del-dia/recepcion-del-dia-page').then((m) => m.RecepcionDelDiaPage),
    title: 'AKINE - Recepcion del dia',
    // Ancho amplio: la tabla tiene seis columnas y la ultima lleva dos acciones. A 46rem entra
    // detras del scroll horizontal el mismo dia que un nombre es largo.
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: 'turnos/:turnoId',
    canActivate: [contextGuard, permissionGuard(PERMISO_TURNO_READ)],
    loadComponent: () =>
      import('./pages/ciclo-de-turno/ciclo-de-turno-page').then((m) => m.CicloDeTurnoPage),
    title: 'AKINE - Ciclo del turno',
  },
];
