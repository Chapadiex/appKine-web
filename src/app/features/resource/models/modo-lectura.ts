import { Signal, computed } from '@angular/core';

import { PERMISO_CONSULTORIO_MANAGE } from '../../../core/models/permisos';
import { PermissionsStore } from '../../../core/services/permissions.store';

/**
 * Modo lectura de las pantallas de horarios (M05, AKINE-02.04).
 *
 * <p>Quien tiene `colaborador:read` pero no `consultorio:manage` —el rol `PROFESIONAL`— ve
 * <b>las mismas pantallas con los mismos datos</b> y ninguna accion. Ocultar los datos junto
 * con los botones seria otra cosa: un profesional tiene que poder mirar su semana, los cierres
 * que lo alcanzan y el horario ya resuelto con sus explicaciones. Lo que desaparece es la
 * posibilidad de cambiarlo.
 *
 * <p><b>Esto es UX, no autorizacion.</b> El backend reevalua rol, grants y alcance en cada
 * request: el boton que no se dibuja corresponde a un endpoint que sigue estando ahi. Lo unico
 * que se evita aca es ofrecer una accion que iba a terminar en `403`.
 *
 * <p><b>No hay ningun componente nuevo de "cascara de solo lectura".</b> El patron del repo es
 * la directiva estructural `*akinePermiso`, que oculta mientras los permisos son desconocidos y
 * nunca muestra-y-despues-oculta. Estas dos funciones son el complemento que la directiva no
 * puede dar, porque no tiene rama `else`: el cartel que <b>explica</b> por que no hay acciones,
 * y el estado deshabilitado de un control que ademas muestra un dato.
 */

/**
 * Texto unico del cartel de modo lectura.
 *
 * <p>Uno solo, y no uno por pantalla, para que las tres digan lo mismo y nombren el
 * <b>mismo</b> permiso: quien lee esto tiene que poder pedirselo a alguien, y un texto que
 * nombre el permiso equivocado hace que se otorgue el permiso equivocado.
 */
export const TEXTO_MODO_LECTURA =
  'Modo lectura: podes consultar todo lo que se muestra, pero no cambiarlo. ' +
  'Cargar, editar o dar de baja necesita el permiso consultorio:manage; pediselo a quien ' +
  'administre el centro.';

/**
 * `true` solo cuando se sabe que el permiso de gestion <b>falta</b>.
 *
 * <p>Depende de `cargados()` a proposito: mientras los permisos son desconocidos no dice ni
 * que si ni que no, igual que la directiva. Afirmar "no tenes permiso" antes de saberlo seria
 * mentirle a un administrador durante el primer tick de la pantalla.
 */
export function modoLectura(permisos: PermissionsStore): Signal<boolean> {
  return computed(() => permisos.cargados() && !permisos.tiene(PERMISO_CONSULTORIO_MANAGE));
}

/**
 * `true` solo cuando consta que el permiso de gestion <b>esta</b>.
 *
 * <p><b>No es la negacion de {@link modoLectura}:</b> con los permisos desconocidos las dos
 * valen `false`. Esa es la propiedad que importa —falla cerrado—, y es la que permite usar
 * esta señal para habilitar un control de formulario sin abrir una ventana en la que el
 * control esta vivo antes de saber si corresponde.
 */
export function puedeGestionar(permisos: PermissionsStore): Signal<boolean> {
  return computed(() => permisos.cargados() && permisos.tiene(PERMISO_CONSULTORIO_MANAGE));
}
