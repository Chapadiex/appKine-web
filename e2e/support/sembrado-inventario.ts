import { ApiAkine, Centro, Oferta, Slot, Turno, agendaDe, fechaLocal, sumarDias } from './sembrado';

/**
 * Sembrado de los E2E del inventario de pantallas no clinicas (quinta tanda): reportes, series
 * reprogramadas, coberturas y aranceles, financiadores, cuenta corriente, suscripcion, auditoria,
 * invitaciones y disponibilidad resuelta.
 *
 * <p>Vive aparte de `sembrado.ts`, `sembrado-configuracion.ts` y `sembrado-pantallas-098.ts` para no
 * pisarse con otros PR que agregan al final de esos archivos. Usa el MISMO centro de `agenda-setup`.
 */

/**
 * Bloques de dias de estos specs, desde HOY en la zona de la sede. Arrancan lejos de los de
 * `DIAS_PANTALLAS_098` (que llegan hasta el 138) y pasan los 90 dias del horizonte con el que el
 * backend simula el impacto de un cambio de horario: un turno de aca no le cambia la cuenta a
 * `flujo-horarios`.
 */
export const DIAS_INVENTARIO = {
  reporte: 150,
  // Una serie de tres semanas que despues se corre: ocupa del 160 al ~185.
  serieReprogramada: 160,
  cuentaCorriente: 195,
} as const;

/** Filas de un CSV (RFC 4180: celdas entre comillas, `""` es una comilla), sin lineas vacias. */
export function leerCsv(texto: string): string[][] {
  return texto
    .split('\r\n')
    .filter((linea) => linea !== '')
    .map((linea) =>
      [...linea.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)].map((m) =>
        m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2],
      ),
    );
}

/** Cancela un turno por la API, con su version vigente. */
export function cancelarTurno(
  api: ApiAkine,
  centro: Centro,
  turno: Turno,
  motivo: string,
): Promise<unknown> {
  return api.exigir(
    'POST',
    `/api/v1/consultorios/${centro.consultorioId}/turnos/${turno.id}/cancelacion`,
    { motivo, expectedVersion: turno.version },
  );
}

/** Lo que una serie necesita para nacer y para correrse una hora: dos horarios por semana libres. */
export interface InicioDeSerie {
  readonly fecha: string;
  /** El horario de la serie. */
  readonly slot: Slot;
  /** El horario al que se corre: mismo dia, otro horario libre las tres semanas. */
  readonly destino: Slot;
}

/** `HH:MM` del instante de un slot, tal como lo devuelve la agenda (hora de la sede). */
function horaDe(slot: Slot): string {
  return slot.desde.slice(11, 16);
}

/**
 * El primer dia desde `desdeHoy` cuyos dos ultimos horarios estan libres `semanas` semanas
 * seguidas. Se usan los ultimos del dia, lejos de los primeros, que son los que eligen los demas
 * tests; un feriado en el medio corre el inicio.
 */
export async function inicioDeSerieConDestino(
  api: ApiAkine,
  centro: Centro,
  oferta: Oferta,
  desdeHoy: number,
  semanas: number,
): Promise<InicioDeSerie> {
  const primero = fechaLocal(centro.timezone, desdeHoy);
  for (let corrimiento = 0; corrimiento < 7; corrimiento++) {
    const fecha = sumarDias(primero, corrimiento);
    const [dia] = await agendaDe(api, centro, oferta.id, fecha);
    const slot = dia.slots.at(-1);
    const destino = dia.slots.at(-2);
    if (slot === undefined || destino === undefined) {
      continue;
    }
    let todas = true;
    for (let semana = 1; semana < semanas && todas; semana++) {
      const [siguiente] = await agendaDe(api, centro, oferta.id, sumarDias(fecha, 7 * semana));
      const horas = siguiente.slots.map(horaDe);
      todas = horas.includes(horaDe(slot)) && horas.includes(horaDe(destino));
    }
    if (todas) {
      return { fecha, slot, destino };
    }
  }
  throw new Error(`ningun dia desde ${primero} tiene dos horarios libres ${semanas} semanas`);
}
