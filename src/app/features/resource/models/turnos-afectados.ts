import { ImpactoDisponibilidadResponse } from '../../../api/generated/model/impacto-disponibilidad-response';

/**
 * Estado de la consulta previa de impacto de un cambio de disponibilidad (A-11, RN-M05-004).
 *
 * <p>El backend publica cuatro consultas <b>sin efectos</b> —editar o dar de baja un bloque,
 * dar de alta o de baja una excepcion— que responden cuantos turnos pendientes quedarian fuera
 * del horario. La pantalla las corre <b>antes</b> de confirmar, para que quien decide sepa a
 * cuantos pacientes les mueve el piso.
 *
 * <p><b>`error` no se degrada a cero.</b> Si la consulta fallo, decir "ningun turno afectado"
 * seria una tranquilidad falsa sobre justo el caso que la consulta existe para frenar. Se dice
 * que no se pudo calcular y se deja confirmar igual: la consulta informa, no decide (ADR-0011).
 */
export type ImpactoPrevio =
  | { readonly tipo: 'consultando' }
  | { readonly tipo: 'listo'; readonly impacto: ImpactoDisponibilidadResponse }
  | { readonly tipo: 'error' };

/** Cuantos turnos dice la consulta previa, o `null` si todavia no hay respuesta valida. */
export function turnosPrevistos(estado: ImpactoPrevio | null): number | null {
  return estado?.tipo === 'listo' ? (estado.impacto.turnosAfectados ?? 0) : null;
}

/**
 * Lo que la consulta previa anticipa, redactado para el panel de confirmacion.
 *
 * <p><b>Es la cuenta exacta, no una cota.</b> Desde A-11 el backend corre el mismo calculador de
 * disponibilidad efectiva antes y despues del cambio y cuenta solo los turnos que estaban
 * cubiertos y dejan de estarlo: un turno que cae en otro bloque vigente del profesional ya no
 * suma.
 */
export function resumenDeImpacto(impacto: ImpactoDisponibilidadResponse): string {
  const cantidad = impacto.turnosAfectados ?? 0;
  if (cantidad <= 0) {
    return 'Ningun turno pendiente queda fuera de horario con este cambio.';
  }
  const turnos = cantidad === 1 ? 'turno pendiente queda' : 'turnos pendientes quedan';
  return (
    `${cantidad} ${turnos} fuera de horario con este cambio. No se cancelan ni se mueven: ` +
    'quedan en la agenda para que los revises.'
  );
}

/** Nota al pie cuando la lista viene recortada: la cuenta es completa, la lista no. */
export function notaDeListaRecortada(impacto: ImpactoDisponibilidadResponse): string | null {
  const cantidad = impacto.turnosAfectados ?? 0;
  const listados = impacto.turnos?.length ?? 0;
  if (listados === 0 || listados >= cantidad) {
    return null;
  }
  return `Se muestran los primeros ${listados} de ${cantidad}, por fecha.`;
}

/**
 * Aviso sobre los turnos que una edicion o una baja de bloque dejo fuera de horario, o `null`.
 *
 * <p>El numero que manda es el de la <b>respuesta de la mutacion</b>: el backend lo recalcula
 * dentro de la misma transaccion y bajo el lock de la sede. Si difiere del que anticipo la
 * consulta previa es porque alguien reservo o cancelo un turno en el medio, y se dice.
 */
export function avisoDeTurnosAfectados(
  turnosAfectados: number | undefined,
  previsto: number | null = null,
): string | null {
  const cantidad = turnosAfectados ?? 0;
  const difiere = previsto !== null && previsto !== cantidad;
  if (cantidad <= 0 && !difiere) {
    return null;
  }

  const base =
    cantidad <= 0
      ? 'Ningun turno pendiente de este profesional quedo fuera de su horario.'
      : `${cantidad} ${cantidad === 1 ? 'turno pendiente' : 'turnos pendientes'} de este ` +
        'profesional en la sede ' +
        (cantidad === 1 ? 'quedo' : 'quedaron') +
        ' fuera de su horario. Ninguno se cancelo; revisalos en la agenda.';

  if (!difiere) {
    return base;
  }
  return (
    `${base} La consulta previa habia calculado ${previsto}: alguien reservo o cancelo un ` +
    'turno mientras confirmabas.'
  );
}

/**
 * Aviso despues del alta o la baja de una excepcion, o `null`.
 *
 * <p>`ExcepcionResponse` no trae la cuenta (diseno A-11, decision 4): el unico numero que existe
 * es el de la consulta previa, y el texto lo atribuye a ella para no presentarlo como un
 * recuento posterior que nadie hizo.
 */
export function avisoDeExcepcion(previsto: number | null): string | null {
  if (previsto === null || previsto <= 0) {
    return null;
  }
  const turnos = previsto === 1 ? 'turno pendiente quedaba' : 'turnos pendientes quedaban';
  return (
    `Segun la consulta previa, ${previsto} ${turnos} fuera de horario. Ninguno se cancelo; ` +
    'revisalos en la agenda. Si alguien reservo mientras confirmabas, puede haber alguno mas.'
  );
}

/**
 * Aviso despues de guardar el horario general de la sede (A-8b, DP-19), o `null` en cero.
 *
 * <p>Desde DP-19 el horario de la sede <b>limita</b> la agenda. El `PUT` del calendario responde
 * en `impactoDelHorario` cuantos turnos pendientes, de cualquier profesional, quedaron fuera del
 * horario nuevo. No se cancelan: se informan para que la sede decida.
 */
export function avisoDeHorarioDeSede(
  impacto: ImpactoDisponibilidadResponse | null | undefined,
): string | null {
  const cantidad = impacto?.turnosAfectados ?? 0;
  if (cantidad <= 0) {
    return null;
  }
  return cantidad === 1
    ? '1 turno queda fuera del horario; revisalo en la agenda. No se cancelo.'
    : `${cantidad} turnos quedan fuera del horario; revisalos en la agenda. Ninguno se cancelo.`;
}
