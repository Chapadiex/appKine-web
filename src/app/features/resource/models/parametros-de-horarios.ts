import { ParamMap } from '@angular/router';

import { esFechaDeCalendario } from './ventana-de-fechas';

/**
 * De quien y de que dia hablaba el enlace que trajo al usuario hasta aca (M05, AKINE-02.04).
 *
 * <p><b>Por que existe.</b> Las cuatro pantallas de horarios se enlazan entre si, y tres de
 * ellas abren con filtros por defecto que no tienen nada que ver con lo que se venia mirando:
 * excepciones arranca en "solo las de toda la sede" sobre noventa dias desde hoy, el calendario
 * sobre un año, y el horario semanal sin ningun profesional elegido. Un salto desde "la excepcion
 * de cierre numero 42 cubre el dia entero" que aterrice en esos valores por defecto puede dejar
 * al cierre 42 <b>fuera de la lista</b> —si es de una persona y no de la sede, que es el caso
 * corriente de una ausencia— sin ninguna senal de que un filtro lo esta tapando.
 *
 * <p><b>Los valores se validan antes de usarse.</b> Una query string la escribe cualquiera: un
 * `membershipId=hola` o un `desde=ayer` tienen que degradar a "no vino nada" y dejar la pantalla
 * con sus valores por defecto, nunca producir una consulta con basura ni un `NaN` en la URL de
 * la API.
 */
export interface ParametrosDeHorarios {
  /** Profesional del que hablaba la explicacion, o `null`. */
  readonly membershipId: number | null;
  /** Primer dia de la ventana, o `null`. Solo se usa junto con {@link hasta}. */
  readonly desde: string | null;
  /** Fin exclusivo de la ventana, o `null`. Solo se usa junto con {@link desde}. */
  readonly hasta: string | null;
}

/** Sin nada util en la query string. */
export const SIN_PARAMETROS: ParametrosDeHorarios = {
  membershipId: null,
  desde: null,
  hasta: null,
};

/** Lee y valida los tres parametros que las pantallas de horarios se pasan entre si. */
export function leerParametrosDeHorarios(parametros: ParamMap): ParametrosDeHorarios {
  const desde = parametros.get('desde');
  const hasta = parametros.get('hasta');
  const ventanaValida =
    desde !== null && hasta !== null && esFechaDeCalendario(desde) && esFechaDeCalendario(hasta);

  return {
    membershipId: numero(parametros.get('membershipId')),
    // La ventana viaja entera o no viaja: media ventana produciria una consulta que mezcla el
    // dia del enlace con el valor por defecto del otro extremo.
    desde: ventanaValida ? desde : null,
    hasta: ventanaValida ? hasta : null,
  };
}

/** Un id positivo, o `null`. `NaN`, cero y negativos no son ids de nada. */
function numero(valor: string | null): number | null {
  if (valor === null || valor.trim() === '') {
    return null;
  }
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}
