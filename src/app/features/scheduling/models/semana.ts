import { TurnoDeCalendario } from '../../../api/generated/model/turno-de-calendario';
import { sumarDias } from './etiquetas-de-agenda';

/**
 * Aritmetica de la semana del calendario de turnos (DP-45).
 *
 * <p>Todas las fechas son dias de calendario `YYYY-MM-DD` <b>de la sede</b>, no instantes: se
 * calculan en UTC a proposito, igual que `sumarDias`, para que ningun huso del navegador las
 * corra. Los instantes de los turnos (UTC) se pasan a dia de la sede con {@link diaEnZona}.
 */

/** `true` si el texto es una fecha `YYYY-MM-DD` valida. */
export function esFecha(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return false;
  }
  const dia = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(dia.getTime()) && dia.toISOString().slice(0, 10) === texto;
}

/** El lunes de la semana (lunes a domingo) que contiene `fecha`. */
export function lunesDe(fecha: string): string {
  const dia = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(dia.getTime())) {
    return fecha;
  }
  // getUTCDay: domingo 0 ... sabado 6. El domingo es el ultimo dia de la semana, no el primero.
  const desdeElLunes = (dia.getUTCDay() + 6) % 7;
  return sumarDias(fecha, -desdeElLunes);
}

/** Los siete dias de la semana que empieza en `lunes`. */
export function diasDeLaSemana(lunes: string): readonly string[] {
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
}

/**
 * El dia de calendario de un instante UTC en la zona dada. Con una zona vacia o desconocida usa
 * UTC, que es lo que la pantalla rotula en ese caso.
 */
export function diaEnZona(instante: string | undefined, timezone: string): string {
  if (instante === undefined || instante === '') {
    return '';
  }
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) {
    return '';
  }
  const formato = (zona: string) =>
    // `en-CA` formatea `YYYY-MM-DD`.
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zona,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(fecha);
  try {
    return formato(timezone === '' ? 'UTC' : timezone);
  } catch {
    return formato('UTC');
  }
}

/** Un dia de la semana con sus turnos, en el orden en que llegaron (por hora de inicio). */
export interface DiaDelCalendario {
  readonly fecha: string;
  readonly turnos: readonly TurnoDeCalendario[];
}

/**
 * Reparte los turnos en los siete dias de la semana segun su inicio en la zona de la sede. Un
 * turno que cae fuera de la semana —no deberia, el servidor filtra por el mismo rango— se descarta.
 */
export function agruparPorDia(
  turnos: readonly TurnoDeCalendario[],
  dias: readonly string[],
  timezone: string,
): readonly DiaDelCalendario[] {
  const porDia = new Map<string, TurnoDeCalendario[]>(dias.map((dia) => [dia, []]));
  for (const turno of turnos) {
    porDia.get(diaEnZona(turno.turno?.inicio, timezone))?.push(turno);
  }
  return dias.map((fecha) => ({ fecha, turnos: porDia.get(fecha) ?? [] }));
}

/** `lun 26` para la cabecera de la columna de un dia. */
export function diaCorto(fecha: string): string {
  const dia = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(dia.getTime())) {
    return fecha;
  }
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
    .format(dia)
    .replace(',', '');
}

/** `26 de octubre al 1 de noviembre de 2026` para el rotulo de la semana. */
export function rotuloDeSemana(lunes: string): string {
  const desde = new Date(`${lunes}T00:00:00Z`);
  if (Number.isNaN(desde.getTime())) {
    return '';
  }
  const hasta = new Date(`${sumarDias(lunes, 6)}T00:00:00Z`);
  const diaYMes = new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return `${diaYMes.format(desde)} al ${diaYMes.format(hasta)} de ${hasta.getUTCFullYear()}`;
}
