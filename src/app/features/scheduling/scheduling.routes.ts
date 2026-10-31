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
 * esconden <b>dentro</b> de la pantalla — un guard con el permiso de gestion dejaria afuera a quien
 * solo quiere ver la lista, que es exactamente lo que el backend si le permite.
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
 * <h2>Un turno no tiene pantalla: se ve y se opera en el panel del flujo unico</h2>
 *
 * <p>Lo abre quien lo muestra, con `FlujoDeTurnosStore.verTurno`, sin salir de donde esta. Lo que
 * queda de `turnos/:turnoId` es una direccion para los enlaces guardados: `pages/abrir-turno`.
 *
 * <p><b>Lleva `permissionGuard` con `turno:read` y no con `turno:manage`</b>, que es lo que exige el
 * historial: leer quien cancelo y por que es parte de mirar la agenda, no de operarla. Las
 * transiciones piden `turno:manage` y esas se esconden <b>dentro</b> del panel. Sigue siendo UX y no
 * seguridad — la autoridad es el backend, que rechaza igual por URL directa.
 */
export const routes: Routes = [
  // La agenda operativa: dia o semana, por profesional o por box. Sin permissionGuard porque es la
  // pantalla de inicio de todo contexto: sin `turno:read` el backend responde 403 y la pantalla lo
  // dice. La fecha, la vista y los filtros viven en la query, asi un enlace abre lo mismo.
  {
    path: '',
    canActivate: [contextGuard],
    loadComponent: () => import('./pages/agenda/agenda-page').then((m) => m.AgendaPage),
    title: 'AKINE - Agenda',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  // Buscar horarios por prestacion. Elegir uno abre el flujo unico, igual que una celda de la agenda.
  {
    path: 'disponibilidad',
    canActivate: [contextGuard],
    loadComponent: () =>
      import('./pages/buscador-de-agenda/buscador-de-agenda-page').then(
        (m) => m.BuscadorDeAgendaPage,
      ),
    title: 'AKINE - Buscar disponibilidad',
    // Ancho amplio: la grilla pone los slots de un dia en una fila y a 46rem una jornada de
    // ocho horas queda detras del scroll horizontal.
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: 'lista-de-espera',
    canActivate: [contextGuard, permissionGuard(PERMISO_TURNO_READ)],
    loadComponent: () =>
      import('./pages/lista-de-espera/lista-de-espera-page').then((m) => m.ListaDeEsperaPage),
    title: 'AKINE - Lista de espera',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  // Direcciones viejas: hay enlaces guardados. Reservar ya no es una pantalla: es un panel del flujo
  // unico que se abre desde la agenda o desde la busqueda.
  { path: 'ofertas/:ofertaId/reservar', redirectTo: 'disponibilidad' },
  { path: 'ofertas/:ofertaId/reservar-serie', redirectTo: 'disponibilidad' },
  // Bandeja de series de la sede (AKINE E-8, contrato 0.68.0). `turno:read`, como ver una serie.
  {
    path: 'series',
    canActivate: [contextGuard, permissionGuard(PERMISO_TURNO_READ)],
    loadComponent: () =>
      import('./pages/bandeja-de-series/bandeja-de-series-page').then((m) => m.BandejaDeSeriesPage),
    title: 'AKINE - Series de turnos',
    // Ancho amplio: siete columnas, y la regla y el paciente llevan dos renglones cada uno.
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: 'series/:serieId',
    canActivate: [contextGuard, permissionGuard(PERMISO_TURNO_READ)],
    loadComponent: () =>
      import('./pages/serie-de-turnos/serie-de-turnos-page').then((m) => m.SerieDeTurnosPage),
    title: 'AKINE - Serie de turnos',
  },
  // El calendario semanal paso a ser la vista Semana de la agenda.
  {
    path: 'calendario',
    redirectTo: ({ queryParams }) => {
      const semana = queryParams['semana'];
      return semana ? `/agenda?vista=semana&fecha=${semana}` : '/agenda?vista=semana';
    },
  },
  {
    path: 'recepcion',
    canActivate: [contextGuard, permissionGuard(PERMISO_TURNO_READ)],
    loadComponent: () =>
      import('./pages/recepcion-del-dia/recepcion-del-dia-page').then((m) => m.RecepcionDelDiaPage),
    title: 'AKINE - Recepción del día',
    // Ancho amplio: la tabla tiene seis columnas y la ultima lleva dos acciones. A 46rem entra
    // detras del scroll horizontal el mismo dia que un nombre es largo.
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  // Direccion de un turno: hay enlaces guardados y avisos. Un turno se ve en el panel del flujo unico,
  // asi que esto abre la agenda en su dia con el panel encima.
  {
    path: 'turnos/:turnoId',
    canActivate: [contextGuard, permissionGuard(PERMISO_TURNO_READ)],
    loadComponent: () =>
      import('./pages/abrir-turno/abrir-turno-page').then((m) => m.AbrirTurnoPage),
    title: 'AKINE - Turno',
  },
];
