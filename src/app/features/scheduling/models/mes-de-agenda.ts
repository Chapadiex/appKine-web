import { AgendaOperativa } from '../../../api/generated/model/agenda-operativa';
import { TurnoDeCalendario } from '../../../api/generated/model/turno-de-calendario';
import { sumarDias } from './etiquetas-de-agenda';
import { tramoEnElDia } from './grilla-de-agenda';
import { diaEnZona, lunesDe } from './semana';

/**
 * La vista Mes de la agenda, sin nada de Angular: que dias se dibujan, en que ventanas se pide y que
 * se cuenta en cada dia.
 *
 * <p>Las fechas son dias de calendario `YYYY-MM-DD` de la sede, igual que en `semana.ts`.
 */

/** La agenda operativa no acepta ventanas de mas de catorce dias: un mes se pide en tramos. */
export const DIAS_POR_PEDIDO = 14;

export function primerDiaDelMes(fecha: string): string {
  return `${fecha.slice(0, 7)}-01`;
}

/** El primer dia del mes que esta `meses` meses antes o despues del de `fecha`. */
export function sumarMeses(fecha: string, meses: number): string {
  const anio = Number(fecha.slice(0, 4));
  const mes = Number(fecha.slice(5, 7)) - 1 + meses;
  const dia = new Date(Date.UTC(anio, mes, 1));
  return dia.toISOString().slice(0, 10);
}

/** `[desde, hasta)` partido en tramos de a lo sumo {@link DIAS_POR_PEDIDO} dias. */
export function ventanasDePedido(
  desde: string,
  hasta: string,
): readonly { readonly desde: string; readonly hasta: string }[] {
  const ventanas: { desde: string; hasta: string }[] = [];
  for (let inicio = desde; inicio < hasta; inicio = sumarDias(inicio, DIAS_POR_PEDIDO)) {
    const fin = sumarDias(inicio, DIAS_POR_PEDIDO);
    ventanas.push({ desde: inicio, hasta: fin < hasta ? fin : hasta });
  }
  return ventanas;
}

/**
 * Las respuestas de cada tramo en una sola agenda. Un turno o un bloqueo que cae en dos tramos llega
 * dos veces y se cuenta una.
 */
export function unirAgendas(
  partes: readonly AgendaOperativa[],
  desde: string,
  hasta: string,
): AgendaOperativa {
  const turnos = new Map<number | string, TurnoDeCalendario>();
  const bloqueos = new Map<string, NonNullable<AgendaOperativa['bloqueos']>[number]>();
  for (const parte of partes) {
    (parte.turnos ?? []).forEach((t, i) => turnos.set(t.turno?.id ?? `${parte.desde}-${i}`, t));
    for (const b of parte.bloqueos ?? []) {
      bloqueos.set(`${b.excepcionId}-${b.membershipId ?? 'sede'}-${b.desde}`, b);
    }
  }
  return {
    desde,
    hasta,
    timezone: partes.find((p) => p.timezone)?.timezone,
    turnos: [...turnos.values()],
    bloqueos: [...bloqueos.values()],
  };
}

export interface DiaDelMes {
  readonly fecha: string;
  readonly delMes: boolean;
  readonly total: number;
  /** Cantidad por estado operativo, en el orden de `estados`; solo los que tienen alguno. */
  readonly porEstado: readonly { readonly estado: string; readonly cantidad: number }[];
  readonly bloqueos: number;
}

/**
 * Las semanas (lunes a domingo) que cubren el mes de `primero`, con los conteos de cada dia del mes.
 * Los dias de los meses vecinos se dibujan vacios: no se pidieron.
 */
export function semanasDelMes(entrada: {
  readonly primero: string;
  readonly agenda: AgendaOperativa | null;
  readonly filtroDeTurno: (turno: TurnoDeCalendario) => boolean;
  readonly profesionalId: number | null;
  readonly estados: readonly string[];
}): readonly (readonly DiaDelMes[])[] {
  const { primero, agenda, estados } = entrada;
  const siguiente = sumarMeses(primero, 1);
  const zona = agenda?.timezone ?? '';

  const turnosPorDia = new Map<string, Map<string, number>>();
  for (const turno of (agenda?.turnos ?? []).filter(entrada.filtroDeTurno)) {
    const dia = diaEnZona(turno.turno?.inicio, zona);
    const estado = turno.turno?.operativo?.estadoOperativo ?? '';
    const delDia = turnosPorDia.get(dia) ?? new Map<string, number>();
    delDia.set(estado, (delDia.get(estado) ?? 0) + 1);
    turnosPorDia.set(dia, delDia);
  }
  const bloqueos = (agenda?.bloqueos ?? []).filter(
    (b) =>
      entrada.profesionalId === null ||
      b.membershipId === undefined ||
      b.membershipId === null ||
      b.membershipId === entrada.profesionalId,
  );

  const semanas: DiaDelMes[][] = [];
  for (let lunes = lunesDe(primero); lunes < siguiente; lunes = sumarDias(lunes, 7)) {
    semanas.push(
      Array.from({ length: 7 }, (_, i) => {
        const fecha = sumarDias(lunes, i);
        const delMes = fecha >= primero && fecha < siguiente;
        const conteo = delMes ? turnosPorDia.get(fecha) : undefined;
        const porEstado = estados
          .map((estado) => ({ estado, cantidad: conteo?.get(estado) ?? 0 }))
          .filter((e) => e.cantidad > 0);
        return {
          fecha,
          delMes,
          total: [...(conteo?.values() ?? [])].reduce((suma, n) => suma + n, 0),
          porEstado,
          bloqueos: delMes
            ? bloqueos.filter((b) => tramoEnElDia(b.desde, b.hasta, fecha, zona) !== null).length
            : 0,
        };
      }),
    );
  }
  return semanas;
}

export function rotuloDeMes(fecha: string): string {
  const dia = new Date(`${primerDiaDelMes(fecha)}T00:00:00Z`);
  if (Number.isNaN(dia.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dia);
}
