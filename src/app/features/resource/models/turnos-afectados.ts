/**
 * Aviso sobre los turnos que una edicion o una baja de bloque pudo dejar en conflicto
 * (RN-M05-004), o `null` si no hay ninguno.
 *
 * <p><b>El numero es una cota superior, y el texto lo dice.</b> El backend cuenta los turnos
 * pendientes del profesional en la sede dentro de la ventana del bloque, sin mirar si caen en
 * <b>otro</b> bloque suyo que sigue vigente: puede avisar de mas, nunca de menos. Presentarlo como
 * "quedaron N turnos sin horario" seria afirmar algo que nadie verifico.
 *
 * <p>El contrato no publica una consulta previa: el numero llega en la respuesta de la mutacion
 * (`turnosAfectados`), asi que se informa despues de aplicar. El backend tampoco bloquea por
 * esto -ADR-0011-: quien decide que hacer con esos turnos es quien administra la agenda.
 */
export function avisoDeTurnosAfectados(turnosAfectados: number | undefined): string | null {
  const cantidad = turnosAfectados ?? 0;
  if (cantidad <= 0) {
    return null;
  }
  const turnos = cantidad === 1 ? 'turno pendiente' : 'turnos pendientes';
  return (
    `Hasta ${cantidad} ${turnos} de este profesional en la sede pueden haber quedado fuera ` +
    'de su horario. Es una cota superior: incluye turnos que caen en otros bloques suyos que ' +
    'siguen vigentes. Ninguno se cancelo; revisalos en la agenda.'
  );
}
