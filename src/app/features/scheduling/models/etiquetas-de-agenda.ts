import {
  DiaDeAgenda,
  DiaDeAgendaMotivoSinSlotsEnum,
} from '../../../api/generated/model/dia-de-agenda';
import { SlotDisponible } from '../../../api/generated/model/slot-disponible';

/**
 * Textos de la agenda (M12, AKINE-05.01).
 *
 * <p>Vive en `features/` y no en `shared/`: sabe que es un slot y que es un motivo de dia vacio,
 * o sea sabe de dominio.
 */

/**
 * Que decirle al usuario cuando un dia no tiene ningun turno.
 *
 * <p><b>Los nueve motivos tienen texto propio, y esa es la razon por la que el backend los
 * distingue.</b> Un dia en blanco es indistinguible de un error del sistema, y un "no hay turnos"
 * generico es casi igual de inutil: el operador que ve "no hay turnos" no sabe si tiene que
 * cargar un horario, habilitar un profesional, corregir la vigencia de la oferta o simplemente
 * probar otro dia. Cada texto dice <b>que pasa</b> y, cuando hay algo que hacer, <b>que hacer</b>.
 *
 * <p><b>`COMPLETO` es el unico que no es una falta de configuracion</b>: el dia esta bien armado y
 * los turnos se ocuparon. Decirlo distinto importa, porque es el unico donde no hay nada que
 * arreglar.
 */
const TEXTOS_SIN_SLOTS: Readonly<Record<DiaDeAgendaMotivoSinSlotsEnum, string>> = {
  [DiaDeAgendaMotivoSinSlotsEnum.FERIADO]: 'Feriado: la sede no atiende este dia.',
  [DiaDeAgendaMotivoSinSlotsEnum.CIERRE]:
    'La sede cierra este dia por una excepcion cargada en el calendario.',
  [DiaDeAgendaMotivoSinSlotsEnum.VINCULO]:
    'El profesional no tiene vinculo vigente con el centro este dia.',
  [DiaDeAgendaMotivoSinSlotsEnum.SIN_HORARIO]:
    'Ningun profesional habilitado tiene horario cargado este dia. Se carga desde Horarios.',
  [DiaDeAgendaMotivoSinSlotsEnum.OFERTA_NO_VIGENTE]:
    'La oferta no esta vigente este dia. Su vigencia se edita desde Ofertas de la sede.',
  [DiaDeAgendaMotivoSinSlotsEnum.SIN_PROFESIONAL]:
    'La oferta necesita un profesional y ninguno de los habilitados atiende este dia.',
  [DiaDeAgendaMotivoSinSlotsEnum.SIN_ESPACIO]:
    'La oferta necesita un espacio y ninguno de los habilitados esta en servicio este dia.',
  [DiaDeAgendaMotivoSinSlotsEnum.FRANJA_MAS_CORTA_QUE_LA_OFERTA]:
    'Las franjas de atencion de este dia son mas cortas que la duracion de la oferta, asi que no ' +
    'entra ningun turno completo.',
  [DiaDeAgendaMotivoSinSlotsEnum.COMPLETO]:
    'Todos los turnos de este dia ya estan reservados. La agenda esta bien: se lleno.',
  [DiaDeAgendaMotivoSinSlotsEnum.FUERA_DE_HORARIO_SEDE]:
    'La sede no atiende en las horas del profesional este dia. El horario general de la sede se edita desde Horarios.',
  [DiaDeAgendaMotivoSinSlotsEnum.PASADO]:
    'Este dia ya no tiene turnos por delante: los horarios que quedaban ya empezaron.',
};

/**
 * Texto del dia sin slots.
 *
 * <p>El respaldo cubre dos casos: un motivo que este cliente no conoce —el contrato puede sumar
 * uno sin romper nada— y el dia vacio que llega sin motivo, que el contrato promete que no pasa.
 * <b>Ninguno de los dos puede terminar en un espacio en blanco</b>, que es exactamente lo que la
 * etapa existe para evitar.
 */
export function textoSinSlots(dia: DiaDeAgenda): string {
  const motivo = dia.motivoSinSlots;
  if (motivo !== undefined && motivo in TEXTOS_SIN_SLOTS) {
    return TEXTOS_SIN_SLOTS[motivo];
  }
  return 'Este dia no tiene turnos disponibles y el servidor no dijo por que.';
}

/** `true` cuando el dia hay que dibujarlo con su motivo y no con una grilla. */
export function diaSinSlots(dia: DiaDeAgenda): boolean {
  return (dia.slots ?? []).length === 0;
}

/**
 * `true` cuando el slot no admite mas reservas.
 *
 * <p>Un slot completo <b>se muestra igual</b>, marcado: un hueco en la grilla el usuario lo lee
 * como "no atiende a esa hora", que es una afirmacion distinta y falsa.
 */
export function slotCompleto(slot: SlotDisponible): boolean {
  return (slot.cupoLibre ?? 0) <= 0;
}

/** `2 de 3 libres` para los slots grupales; vacio para los individuales, donde seria ruido. */
export function textoDeCupo(slot: SlotDisponible): string {
  const total = slot.cupoTotal ?? 1;
  if (total <= 1) {
    return '';
  }
  return `${slot.cupoLibre ?? 0} de ${total} libres`;
}

/**
 * Hora local de la sede para un instante UTC.
 *
 * <p><b>La zona sale de la respuesta, no del navegador.</b> Los instantes viajan en UTC y la sede
 * puede estar en otro huso que quien mira la pantalla: formatear con la zona local del navegador
 * mostraria horarios corridos sin que nada falle. Por eso `timezone` viaja en `Agenda` y por eso
 * la pantalla lo rotula.
 */
export function horaEnZona(instante: string | undefined, timezone: string): string {
  if (instante === undefined || instante === '') {
    return '';
  }
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zonaValida(timezone),
  }).format(fecha);
}

/** `09:00 a 09:45` en la zona de la sede. El fin es exclusivo. */
export function rangoEnZona(slot: SlotDisponible, timezone: string): string {
  return `${horaEnZona(slot.desde, timezone)} a ${horaEnZona(slot.hasta, timezone)}`;
}

/**
 * `lunes 15 de septiembre` para una fecha local de la sede.
 *
 * <p>Se formatea en UTC a proposito: `fecha` ya es la fecha local de la sede —`2026-09-15`—, no un
 * instante. Interpretarla con la zona del navegador la correria un dia hacia atras en cualquier
 * huso al oeste de Greenwich, que es donde esta el pais entero.
 */
export function fechaEnPalabras(fecha: string | undefined): string {
  if (fecha === undefined || fecha === '') {
    return '';
  }
  const dia = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(dia.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(dia);
}

/** Suma dias a una fecha local `YYYY-MM-DD`. Sin husos: es aritmetica de calendario. */
export function sumarDias(fecha: string, dias: number): string {
  const dia = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(dia.getTime())) {
    return fecha;
  }
  dia.setUTCDate(dia.getUTCDate() + dias);
  return dia.toISOString().slice(0, 10);
}

/** Hoy, en fecha local del navegador. Es el default del buscador, no una regla de negocio. */
export function hoy(): string {
  const ahora = new Date();
  const local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * La zona de la respuesta, o UTC si vino vacia o no la conoce el navegador.
 *
 * <p>`Intl` lanza ante una zona invalida, y una excepcion en el formateo dejaria la grilla entera
 * en blanco por un rotulo.
 */
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
