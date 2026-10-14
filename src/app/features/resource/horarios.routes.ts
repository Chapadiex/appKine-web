import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { PERMISO_COLABORADOR_READ } from '../../core/models/permisos';
import { permissionGuard } from '../../core/guards/permission.guard';
import {
  SEGMENTO_CALENDARIO,
  SEGMENTO_EFECTIVO,
  SEGMENTO_EXCEPCIONES,
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
export const routes: Routes = [
  // Las rutas fijas de las pantallas hermanas de esta etapa —excepciones, horario efectivo y
  // calendario de sede— van ARRIBA de la ruta vacia y, sobre todo, arriba de cualquier futura
  // ruta parametrica: el dia que exista un `horarios/:membershipId` se comeria a todas sin que
  // nadie lo note.
  {
    path: SEGMENTO_EXCEPCIONES,
    canActivate: [permissionGuard(PERMISO_COLABORADOR_READ)],
    loadComponent: () =>
      import('./pages/excepciones/excepciones-page').then((m) => m.ExcepcionesPage),
    title: 'AKINE - Cierres y aperturas',
    // Cada excepcion son fechas, franja, alcance y motivo: en el ancho de lectura cada fila
    // se parte en cinco renglones y el listado deja de leerse como una lista.
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: SEGMENTO_EFECTIVO,
    canActivate: [permissionGuard(PERMISO_COLABORADOR_READ)],
    loadComponent: () =>
      import('./pages/efectivo/horario-efectivo-page').then((m) => m.HorarioEfectivoPage),
    title: 'AKINE - Horario efectivo del profesional',
    // Cada dia lleva sus franjas y, si quedo vacio, el parrafo que lo explica: en el ancho de
    // lectura la explicacion se parte en cinco renglones y deja de leerse como una lista.
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
  {
    path: SEGMENTO_CALENDARIO,
    canActivate: [permissionGuard(PERMISO_COLABORADOR_READ)],
    loadComponent: () =>
      import('./pages/calendario/calendario-sede-page').then((m) => m.CalendarioSedePage),
    title: 'AKINE - Horario general y feriados de la sede',
  },
  {
    path: '',
    canActivate: [permissionGuard(PERMISO_COLABORADOR_READ)],
    loadComponent: () =>
      import('./pages/horarios/horario-semanal-page').then((m) => m.HorarioSemanalPage),
    title: 'AKINE - Horario semanal del profesional',
    // La semana son siete columnas: en el ancho de lectura entran dos por fila y el horario
    // deja de leerse como una semana.
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
];
