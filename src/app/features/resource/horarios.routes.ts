import { Route, Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { PERMISO_COLABORADOR_READ } from '../../core/models/permisos';
import { permissionGuard } from '../../core/guards/permission.guard';
import {
  SEGMENTO_CALENDARIO,
  SEGMENTO_CALENDARIO_FERIADOS,
  SEGMENTO_CALENDARIO_HORARIO,
  SEGMENTO_CAMBIOS,
  SEGMENTO_EFECTIVO,
  SEGMENTO_EXCEPCIONES,
  SEGMENTO_EXCEPCIONES_VIEJO,
} from './models/rutas-de-horarios';

/**
 * Rutas de horarios de profesional (M05, etapa AKINE-02.04).
 *
 * <p><b>Por que un archivo de rutas propio y no `resource.routes.ts`.</b> Las dos familias
 * viven en la feature `resource`, pero responden preguntas distintas y se montan en raices
 * distintas: `/espacios` es "que recursos fisicos hay y si estan en servicio" (M04) y
 * `/horarios` es "cuando trabaja cada persona" (M05). Mezclarlas dejaria pantallas de personas
 * colgando de una URL que dice "espacios", que es exactamente la confusion que el ruling de
 * nomenclatura de esta etapa existe para evitar: ya hay una pantalla llamada
 * <b>disponibilidad</b> que habla de boxes y no de gente.
 *
 * <p><b>`authGuard` y `contextGuard` los pone la ruta padre</b> en `app.routes.ts`, como en el
 * resto de las features: los guards de un padre corren antes que los de sus hijas y repetirlos
 * solo agregaria dos lugares donde olvidarse de uno.
 *
 * <p><b>No hay `:consultorioId` en la URL</b>, por el mismo motivo que en espacios: la sede es
 * la del contexto de trabajo activo, y un id en la URL seria un segundo lugar desde donde
 * elegir tenant. El `membershipId` del profesional tampoco: se elige en la pantalla, porque el
 * horario de una persona no es una direccion que se comparta ni se marque como favorita.
 *
 * <p><b>El listado si lleva `permissionGuard`, a diferencia del de espacios.</b> Aca la
 * lectura no es "cualquier miembro vigente": el contrato exige `colaborador:read` tanto para
 * los bloques como para el listado de vinculos que alimenta el selector. Sin el guard, quien
 * no lo tiene llega a una pantalla que solo puede mostrarle dos `403`. El guard es UX; la
 * autoridad sigue siendo el backend, que reevalua en cada request.
 *
 * <p><b>Las mutaciones exigen `consultorio:manage`</b> y van detras de `*akinePermiso` dentro
 * de la pantalla, no de un guard: la lectura del horario tiene sentido por si sola. Quien tiene
 * `colaborador:read` y no `consultorio:manage` —el rol `PROFESIONAL`— entra igual y ve las
 * mismas pantallas con los mismos datos y ninguna accion (ver `models/modo-lectura.ts`).
 *
 * <p><b>Los segmentos salen de `models/rutas-de-horarios.ts`</b>, que es de donde tambien salen
 * los `routerLink` de las cuatro plantillas y la raiz que monta `app.routes.ts`. Escribirlos a
 * mano en los dos lados es la forma exacta en la que este proyecto dejo los enlaces de correo
 * de AKINE-01.02 cayendo en el comodin `**` durante meses. `horarios.routes.spec.ts` verifica
 * ademas que las cuatro URLs resuelvan de verdad contra la configuracion montada: una constante
 * garantiza que los dos lados digan lo mismo, no que la ruta exista.
 */
/**
 * Las cinco hijas comparten el guard de lectura y el ancho amplio, y solo cambian segmento,
 * pantalla y titulo. Se arman con {@link hija} en vez de escribir cinco objetos completos: estas
 * rutas viajan en el bundle inicial (son hijas eager de `app.routes.ts`, que esta al limite del
 * presupuesto) y cada clave repetida se paga en bytes. La ruta de cambios entro pagada con esto.
 *
 * <p>Todas van en el ancho amplio: excepciones (fechas, franja, alcance y motivo por fila), el
 * efectivo (franjas y el parrafo que explica un dia vacio), el calendario (horario general y
 * feriados lado a lado), los cambios (antes, ahora, quien y motivo) y la semana (siete columnas).
 * En el ancho de lectura cada una deja de leerse como lista o como semana.
 */
const LECTURA = [permissionGuard(PERMISO_COLABORADOR_READ)];
const AMPLIO = { [DATA_ANCHO]: ANCHO_AMPLIO };

function hija(
  path: string,
  loadComponent: Route['loadComponent'],
  title: string,
  data: Route['data'] = {},
): Route {
  return { path, canActivate: LECTURA, loadComponent, title, data: { ...AMPLIO, ...data } };
}

const calendario: Route['loadComponent'] = () =>
  import('./pages/calendario/calendario-sede-page').then((m) => m.CalendarioSedePage);

export const routes: Routes = [
  // Las rutas fijas de las pantallas hermanas de esta etapa —excepciones, horario efectivo,
  // calendario de sede y cambios— van ARRIBA de la ruta vacia y, sobre todo, arriba de cualquier
  // futura ruta parametrica: el dia que exista un `horarios/:membershipId` se comeria a todas sin
  // que nadie lo note.
  hija(
    SEGMENTO_EXCEPCIONES,
    () => import('./pages/excepciones/excepciones-page').then((m) => m.ExcepcionesPage),
    'AKINE - Cierres y aperturas',
  ),
  hija(
    SEGMENTO_EFECTIVO,
    () => import('./pages/efectivo/horario-efectivo-page').then((m) => m.HorarioEfectivoPage),
    'AKINE - Horario efectivo del profesional',
  ),
  // Las pestañas del calendario de la sede: la misma pantalla, abierta en otro panel.
  hija(SEGMENTO_CALENDARIO, calendario, 'AKINE - Calendario de la sede', { pestana: 'resumen' }),
  hija(SEGMENTO_CALENDARIO_HORARIO, calendario, 'AKINE - Horario general de la sede', {
    pestana: 'horario',
  }),
  hija(SEGMENTO_CALENDARIO_FERIADOS, calendario, 'AKINE - Feriados de la sede', {
    pestana: 'feriados',
  }),
  { path: SEGMENTO_EXCEPCIONES_VIEJO, redirectTo: SEGMENTO_EXCEPCIONES },
  hija(
    SEGMENTO_CAMBIOS,
    () => import('./pages/cambios/cambios-de-agenda-page').then((m) => m.CambiosDeAgendaPage),
    'AKINE - Cambios de la agenda',
  ),
  hija(
    '',
    () => import('./pages/horarios/horario-semanal-page').then((m) => m.HorarioSemanalPage),
    'AKINE - Horario semanal del profesional',
  ),
];
