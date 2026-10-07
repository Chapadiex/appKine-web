import { EventoDeTurno, EventoDeTurnoTipoEnum } from '../../../api/generated/model/evento-de-turno';
import { TurnoEstadoEnum } from '../../../api/generated/model/turno';

/**
 * Textos y lecturas derivadas del ciclo de vida del turno (M12, AKINE-05.03).
 *
 * <p>Vive en `features/` y no en `shared/`: sabe que es un turno, que es una ausencia y por que
 * cancelar y marcar ausente no son lo mismo. O sea, sabe de dominio (AGENT.md 4.1).
 *
 * <h2>Por que hay funciones que reconstruyen el turno desde el historial</h2>
 *
 * <p>Porque el contrato 0.21.0 <b>no publica ninguna lectura de un turno</b>: no hay
 * `GET /turnos/{turnoId}` ni listado. Lo unico que se puede pedir de un turno existente es su
 * historial, asi que el estado y el horario actuales salen del <b>ultimo evento</b>. La `version`
 * no sale de ningun lado, y esa es la limitacion real de esta etapa.
 */

/**
 * Que significa cada estado de la RESERVA, en una linea.
 *
 * <p><b>`CANCELADO` y `AUSENTE` no son sinonimos y el texto lo dice.</b> Cancelar libera el lugar;
 * la ausencia no, porque la hora se consumio igual y el profesional estuvo ahi. Es la distincion
 * que DP-04 protege y la que un rotulo perezoso —"turno no realizado" para los dos— borraria.
 *
 * <p><b>`EN_ESPERA` ya no es un estado del turno</b> (DP-16, contrato 0.63.0): la llegada y la
 * espera son de la Recepcion (`etiquetas-de-recepcion.ts`) y el servidor dejo de emitirlo. El
 * enum generado lo conserva declarado una version mas, y los <b>eventos historicos</b> del turno
 * pueden seguir trayendolo en `estadoAnterior`/`estadoNuevo`: por eso queda un texto de
 * historia, escrito con el literal y no con el miembro deprecado del enum.
 *
 * <p>Ninguno de los cuatro dice nada sobre la atencion: que el paciente haya sido atendido lo dice
 * la Sesion (DP-05, regla maestra 4).
 */
const TEXTOS_DE_ESTADO: Readonly<Record<string, string>> = {
  [TurnoEstadoEnum.RESERVADO]: 'Reservado — el lugar esta tomado, falta confirmarlo',
  [TurnoEstadoEnum.CONFIRMADO]:
    'Confirmado — la reserva quedo confirmada, no el cobro ni la llegada',
  [TurnoEstadoEnum.CANCELADO]: 'Cancelado — el lugar se libero y volvio a la agenda',
  [TurnoEstadoEnum.AUSENTE]: 'Ausente — el paciente no vino y la hora se consumio igual',
  // Solo historia: lo traen eventos anteriores a DP-16. Hoy la espera es de la Recepcion.
  EN_ESPERA: 'En espera (historico) — la llegada se registraba en el turno, antes de la recepcion',
};

const TEXTOS_DE_EVENTO: Readonly<Record<EventoDeTurnoTipoEnum, string>> = {
  [EventoDeTurnoTipoEnum.RESERVA]: 'Se reservo el turno',
  [EventoDeTurnoTipoEnum.CONFIRMACION]: 'Se confirmo la reserva',
  [EventoDeTurnoTipoEnum.CANCELACION]: 'Se cancelo el turno',
  [EventoDeTurnoTipoEnum.REPROGRAMACION]: 'Se movio a otro horario',
  [EventoDeTurnoTipoEnum.AUSENCIA]: 'Se registro que el paciente no vino',
  [EventoDeTurnoTipoEnum.LLEGADA]: 'Llego al centro',
  [EventoDeTurnoTipoEnum.LLEGADA_DESHECHA]: 'Se deshizo el registro de llegada',
};

/** Estados desde los que ya no hay ninguna transicion posible. */
const TERMINALES: ReadonlySet<string> = new Set<string>([
  TurnoEstadoEnum.CANCELADO,
  TurnoEstadoEnum.AUSENTE,
]);

/**
 * Texto del estado, o el codigo crudo si el contrato sumo uno que este cliente no conoce.
 *
 * <p>Devolver el codigo es peor que un texto y muchisimo mejor que una celda en blanco: un estado
 * vacio se lee como "no tiene estado", que de un turno nunca es verdad.
 */
export function textoDeEstado(estado: string | undefined): string {
  if (estado === undefined || estado === '') {
    return 'Estado desconocido';
  }
  return TEXTOS_DE_ESTADO[estado] ?? estado;
}

/** Texto del evento, con el mismo respaldo que {@link textoDeEstado}. */
export function textoDeEvento(tipo: string | undefined): string {
  if (tipo === undefined || tipo === '') {
    return 'Cambio de estado';
  }
  return TEXTOS_DE_EVENTO[tipo as EventoDeTurnoTipoEnum] ?? tipo;
}

/**
 * Estado actual segun el historial: el `estadoNuevo` del ultimo evento.
 *
 * <p>El backend los devuelve <b>de la mas vieja a la mas nueva</b>, asi que el ultimo es el
 * vigente. Con historial vacio devuelve cadena vacia y no un estado inventado: un turno sin
 * eventos no existe, y suponer `RESERVADO` habilitaria botones sobre nada.
 */
export function estadoSegunHistorial(eventos: readonly EventoDeTurno[]): string {
  for (let i = eventos.length - 1; i >= 0; i -= 1) {
    const estado = eventos[i].estadoNuevo;
    if (estado !== undefined && estado !== '') {
      return estado;
    }
  }
  return '';
}

/**
 * Horario vigente segun el historial: el `inicioNuevo`/`finNuevo` del ultimo evento que lo trae.
 *
 * <p>Solo la reserva y la reprogramacion mueven el horario, y las dos lo publican. Recorrer de
 * atras para adelante es lo que hace que una reprogramacion gane sobre la reserva original sin
 * tener que saber que tipos de evento existen.
 */
export function horarioSegunHistorial(eventos: readonly EventoDeTurno[]): {
  readonly inicio: string;
  readonly fin: string;
} {
  for (let i = eventos.length - 1; i >= 0; i -= 1) {
    const inicio = eventos[i].inicioNuevo;
    if (inicio !== undefined && inicio !== '') {
      return { inicio, fin: eventos[i].finNuevo ?? '' };
    }
  }
  return { inicio: '', fin: '' };
}

/** `true` cuando el turno ya cerro su ciclo y ninguna transicion es posible. */
export function esTerminal(estado: string): boolean {
  return TERMINALES.has(estado);
}

/**
 * Fecha y hora completas en la zona de la sede.
 *
 * <p>Misma razon que en la agenda: los instantes viajan en UTC y la sede puede estar en otro huso
 * que quien mira la pantalla. Formatear con la zona del navegador correria los horarios del
 * historial sin que nada falle.
 */
export function fechaHoraEnZona(instante: string | undefined, timezone: string): string {
  if (instante === undefined || instante === '') {
    return '';
  }
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zonaValida(timezone),
  }).format(fecha);
}

/** La zona pedida, o UTC si vino vacia o el navegador no la conoce. Ver `etiquetas-de-agenda`. */
function zonaValida(timezone: string): string {
  if (timezone === '') {
    return 'UTC';
  }
  try {
    new Intl.DateTimeFormat('es-AR', { timeZone: timezone });
    return timezone;
  } catch {
    return 'UTC';
  }
}
