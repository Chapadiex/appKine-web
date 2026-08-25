import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { PERMISO_CONSULTORIO_MANAGE } from '../../core/models/permisos';
import { permissionGuard } from '../../core/guards/permission.guard';

/**
 * Rutas de la feature `resource` (espacios y boxes, M04, etapa AKINE-02.02).
 *
 * <p>Se monta bajo `espacios` desde `app.routes.ts` con `loadChildren`, segun ADR-0004.
 * <b>`authGuard` y `contextGuard` los pone la ruta padre</b> y valen para las tres de aca: los
 * guards de una ruta padre corren antes que los de sus hijas, y repetirlos solo agregaria dos
 * lugares donde olvidarse de uno.
 *
 * <p><b>No hay `:consultorioId` en ninguna URL, y no es un olvido.</b> La sede es la del
 * contexto de trabajo activo. Un id en la URL seria un segundo lugar desde donde elegir tenant,
 * y el unico que el token acota es el del contexto: la unica cosa que lograria es que el
 * backend responda `403` sobre una URL que parece valida.
 *
 * <p><b>El listado NO lleva `permissionGuard`.</b> `GET .../espacios` exige solo ser miembro
 * vigente de la organizacion, con cualquier rol: es la lectura que necesita un profesional para
 * saber en que box atiende. Exigir `consultorio:manage` para mirar la tabla dejaria afuera a
 * medio equipo. Las acciones de cada fila si van detras de `*akinePermiso`.
 *
 * <p><b>La disponibilidad tampoco.</b> Es la misma lectura, en otra forma.
 *
 * <p><b>El alta si exige `consultorio:manage`</b>: es una pantalla que no tiene ningun sentido
 * en modo lectura -no hay nada que ver, solo un formulario que siempre iba a terminar en `403`-.
 * El guard es UX; la autoridad sigue siendo el backend, que reevalua rol, grants y alcance en
 * cada request y rechaza igual a quien llegue por URL directa.
 */
export const routes: Routes = [
  // El alta y la disponibilidad antes que el listado: hoy son paths distintos y el orden no
  // cambiaria nada, pero el dia que exista un `espacios/:id` la ruta parametrica se comeria las
  // dos sin que nadie lo note.
  {
    path: 'nuevo',
    canActivate: [permissionGuard(PERMISO_CONSULTORIO_MANAGE)],
    loadComponent: () =>
      import('./pages/new-espacio/new-espacio-page').then((m) => m.NewEspacioPage),
    title: 'AKINE - Dar de alta un espacio',
    // Sin `ancho`: el defecto de lectura es el correcto para un formulario. Un renglon de 90
    // caracteres se lee mejor, y aca no hay ninguna tabla que ensanchar.
  },
  {
    path: 'disponibilidad',
    loadComponent: () =>
      import('./pages/disponibilidad/disponibilidad-page').then((m) => m.DisponibilidadPage),
    title: 'AKINE - Espacios en servicio',
    // Sin `ancho`, aunque tenga una tabla: son tres columnas cortas -nombre, tipo, capacidad-
    // y a 1216px quedaban separadas por medio metro de blanco, con la vista saltando de una a
    // otra. El ancho de tabla existe para las tablas que no entran, no para todas.
  },
  {
    path: '',
    loadComponent: () => import('./pages/espacios/espacios-page').then((m) => m.EspaciosPage),
    title: 'AKINE - Espacios y boxes',
    // Cinco columnas mas la de acciones no entran en los 46rem de lectura: sin esto, "Editar" y
    // "Dar de baja" quedan detras del scroll horizontal y para el usuario no existen.
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
];
