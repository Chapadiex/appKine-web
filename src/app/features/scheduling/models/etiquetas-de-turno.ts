import { CoberturaResponse } from '../../../api/generated/model/cobertura-response';
import { EventoDeTurnoTipoEnum } from '../../../api/generated/model/evento-de-turno';
import { TurnoEstadoEnum } from '../../../api/generated/model/turno';

/**
 * Textos y lecturas derivadas del ciclo de vida del turno (M12, AKINE-05.03).
 *
 * <p>Vive en `features/` y no en `shared/`: sabe que es un turno, que es una ausencia y por que
 * cancelar y marcar ausente no son lo mismo. O sea, sabe de dominio (AGENT.md 4.1).
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
  [TurnoEstadoEnum.RESERVADO]: 'Reservado — el lugar está tomado, falta confirmarlo',
  [TurnoEstadoEnum.CONFIRMADO]:
    'Confirmado — la reserva quedó confirmada, no el cobro ni la llegada',
  [TurnoEstadoEnum.CANCELADO]: 'Cancelado — el lugar se liberó y volvió a la agenda',
  [TurnoEstadoEnum.AUSENTE]: 'Ausente — el paciente no vino y la hora se consumió igual',
  // Solo historia: lo traen eventos anteriores a DP-16. Hoy la espera es de la Recepcion.
  EN_ESPERA: 'En espera (historico) — la llegada se registraba en el turno, antes de la recepción',
};

const TEXTOS_DE_EVENTO: Readonly<Record<EventoDeTurnoTipoEnum, string>> = {
  CAMBIO_DE_CONTEXTO: 'Cambio de caso o plan',
  [EventoDeTurnoTipoEnum.RESERVA]: 'Se reservó el turno',
  [EventoDeTurnoTipoEnum.CONFIRMACION]: 'Se confirmó la reserva',
  [EventoDeTurnoTipoEnum.CANCELACION]: 'Se canceló el turno',
  [EventoDeTurnoTipoEnum.REPROGRAMACION]: 'Se movió a otro horario',
  [EventoDeTurnoTipoEnum.AUSENCIA]: 'Se registró que el paciente no vino',
  [EventoDeTurnoTipoEnum.LLEGADA]: 'Llegó al centro',
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

/**
 * El nombre del estado solo ("Confirmado"), para la pastilla de estado. Es la parte de
 * {@link textoDeEstado} antes de la raya: un solo texto de origen, partido en dos para mostrarlo.
 */
export function nombreDeEstado(estado: string | undefined): string {
  return textoDeEstado(estado).split(' — ')[0];
}

/** Lo que significa el estado ("la reserva quedo confirmada…"), o vacio si no hay explicacion. */
export function detalleDeEstado(estado: string | undefined): string {
  const detalle = textoDeEstado(estado).split(' — ')[1] ?? '';
  return detalle.charAt(0).toUpperCase() + detalle.slice(1);
}

/** Texto del evento, con el mismo respaldo que {@link textoDeEstado}. */
export function textoDeEvento(tipo: string | undefined): string {
  if (tipo === undefined || tipo === '') {
    return 'Cambio de estado';
  }
  return TEXTOS_DE_EVENTO[tipo as EventoDeTurnoTipoEnum] ?? tipo;
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

/**
 * Una cobertura del paciente en una linea, para elegirla al reservar: financiador y plan.
 *
 * <p>Vive aca y no se importa de `person` porque un feature no importa de otro (AGENT.md 4.4).
 */
export function coberturaParaReservar(cobertura: CoberturaResponse): string {
  const financiador = cobertura.financiadorNombre ?? 'Financiador sin nombre';
  const plan = cobertura.planNombre;
  const nombre = plan === undefined || plan === '' ? financiador : `${financiador} — ${plan}`;
  return cobertura.principal === true ? `${nombre} (principal)` : nombre;
}

/**
 * El estado que muestra la agenda, con texto: el color nunca es la unica senal (TURNO.md §33). Es la
 * foto combinada de reserva, recepcion y atencion que deriva el backend (`OperativoDeTurno`).
 */
const NOMBRES_OPERATIVOS: Readonly<Record<string, string>> = {
  RESERVADO: 'Reservado',
  CONFIRMADO: 'Confirmado',
  PRESENTE: 'Paciente presente',
  RETIRADO: 'Se retiró',
  EN_ATENCION: 'En atención',
  ATENDIDO: 'Atendido',
  AUSENTE: 'Ausente',
  CANCELADO: 'Cancelado',
};

export function nombreDeEstadoOperativo(estado: string | undefined): string {
  return NOMBRES_OPERATIVOS[estado ?? ''] ?? estado ?? '';
}

/** Un simbolo por estado: junto con el texto, distingue el estado sin depender del color. */
const SIMBOLOS_OPERATIVOS: Readonly<Record<string, string>> = {
  RESERVADO: '○',
  CONFIRMADO: '●',
  PRESENTE: '◆',
  RETIRADO: '↩',
  EN_ATENCION: '▶',
  ATENDIDO: '✓',
  AUSENTE: '✕',
  CANCELADO: '⊘',
};

export function simboloDeEstadoOperativo(estado: string | undefined): string {
  return SIMBOLOS_OPERATIVOS[estado ?? ''] ?? '';
}

/** A quien se le atribuye una cancelacion, para el historial y los selectores. */
export const ORIGENES_DE_CANCELACION = [
  { valor: 'PACIENTE', etiqueta: 'Paciente' },
  { valor: 'PROFESIONAL', etiqueta: 'Profesional' },
  { valor: 'INSTITUCION', etiqueta: 'Institución' },
] as const;

export const MOTIVOS_DE_CANCELACION = [
  'Solicitud del paciente',
  'Enfermedad',
  'Problema personal',
  'Ausencia del profesional',
  'Decisión de la institución',
  'Otro',
] as const;

export const MOTIVOS_DE_REPROGRAMACION = [
  'Solicitud del paciente',
  'Solicitud del profesional',
  'Decisión de la institución',
  'Otro',
] as const;

export const MOTIVOS_DE_BLOQUEO = [
  { valor: 'LICENCIA', etiqueta: 'Licencia' },
  { valor: 'CAPACITACION', etiqueta: 'Capacitación' },
  { valor: 'AUSENCIA', etiqueta: 'Personal' },
  { valor: 'BLOQUEO', etiqueta: 'Institucional' },
  { valor: 'OTRO', etiqueta: 'Otro' },
] as const;

/** Que tan urgente es quien espera. El backend ordena la lista por esto y, despues, por antiguedad. */
export const PRIORIDADES_DE_ESPERA = [
  { valor: 'NORMAL', etiqueta: 'Normal' },
  { valor: 'ALTA', etiqueta: 'Alta' },
  { valor: 'URGENTE', etiqueta: 'Urgente' },
] as const;

export function nombreDePrioridad(prioridad: string | undefined): string {
  return PRIORIDADES_DE_ESPERA.find((p) => p.valor === prioridad)?.etiqueta ?? prioridad ?? '';
}

/** Los dias de la semana, ISO y abreviados: los checkboxes y las celdas de la lista de espera. */
export const DIAS_ABREVIADOS = [
  { iso: 1, etiqueta: 'Lun' },
  { iso: 2, etiqueta: 'Mar' },
  { iso: 3, etiqueta: 'Mié' },
  { iso: 4, etiqueta: 'Jue' },
  { iso: 5, etiqueta: 'Vie' },
  { iso: 6, etiqueta: 'Sáb' },
  { iso: 7, etiqueta: 'Dom' },
] as const;
