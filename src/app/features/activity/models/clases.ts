import { Clase } from '../../../api/generated/model/clase';
import { Inscripcion } from '../../../api/generated/model/inscripcion';

/**
 * Etiquetas y cuentas de fecha de las clases grupales (M28, AKINE-08.01 y 08.02).
 *
 * <p><b>Todo instante se lee y se escribe en la zona de la SEDE</b>, nunca en la del navegador: la
 * grilla de la semana, el formulario de alta y la reprogramacion trabajan con fecha y hora de pared
 * de la sede y viajan al backend como instante UTC. Resolverlo con la zona del navegador correria
 * la clase entera sin fallar, que es el defecto que #43 corrigio en la agenda.
 */

/** Los cuatro estados que el backend publica para una clase (`EstadoClase`). */
const ESTADOS_DE_CLASE: Readonly<Record<string, string>> = {
  PROGRAMADA: 'Programada',
  EN_CURSO: 'En curso',
  REALIZADA: 'Realizada',
  CANCELADA: 'Cancelada',
};

/** Los seis estados de una inscripcion (`EstadoInscripcion`). */
const ESTADOS_DE_INSCRIPCION: Readonly<Record<string, string>> = {
  RESERVADA: 'Reservada',
  CONFIRMADA: 'Confirmada',
  ASISTIO: 'Asistio',
  AUSENTE: 'Ausente',
  CANCELADA: 'Cancelada',
  LISTA_ESPERA: 'En lista de espera',
};

const EVENTOS_DE_CLASE: Readonly<Record<string, string>> = {
  CREACION: 'Programada',
  REPROGRAMACION: 'Reprogramada',
  CANCELACION: 'Cancelada',
};

export function textoDeEstadoDeClase(estado: string | undefined): string {
  return ESTADOS_DE_CLASE[estado ?? ''] ?? estado ?? 'Sin estado';
}

export function textoDeEstadoDeInscripcion(estado: string | undefined): string {
  return ESTADOS_DE_INSCRIPCION[estado ?? ''] ?? estado ?? 'Sin estado';
}

export function textoDeEventoDeClase(tipo: string | undefined): string {
  return EVENTOS_DE_CLASE[tipo ?? ''] ?? tipo ?? 'Evento';
}

/** Solo una clase PROGRAMADA admite reprogramar, cancelar e inscribir (`admiteTransicion`). */
export function admiteCambios(clase: Clase | null | undefined): boolean {
  return clase?.estado === 'PROGRAMADA';
}

/** Una inscripcion viva con lugar se puede dar de baja; una en espera tambien (sale de la cola). */
export function admiteBaja(inscripcion: Inscripcion | undefined): boolean {
  const estado = inscripcion?.estado;
  return estado === 'RESERVADA' || estado === 'CONFIRMADA' || estado === 'LISTA_ESPERA';
}

/** Solo RESERVADA pasa a CONFIRMADA; las demas no tienen nada que confirmar. */
export function admiteConfirmacion(inscripcion: Inscripcion | undefined): boolean {
  return inscripcion?.estado === 'RESERVADA';
}

// ---------------------------------------------------------------------------------------------
// Fechas en la zona de la sede
// ---------------------------------------------------------------------------------------------

/** Partes de calendario de un instante en una zona. Zona vacia o invalida: la del navegador. */
function partesEnZona(instante: Date, zona: string): Record<string, number> {
  const opciones: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  };
  let formato: Intl.DateTimeFormat;
  try {
    formato = new Intl.DateTimeFormat(
      'en-US',
      zona === '' ? opciones : { ...opciones, timeZone: zona },
    );
  } catch {
    formato = new Intl.DateTimeFormat('en-US', opciones);
  }
  const partes: Record<string, number> = {};
  for (const parte of formato.formatToParts(instante)) {
    if (parte.type !== 'literal') {
      partes[parte.type] = Number(parte.value);
    }
  }
  return partes;
}

/** Desfasaje de la zona respecto de UTC en ese instante, en milisegundos. */
function desfasaje(instante: Date, zona: string): number {
  const p = partesEnZona(instante, zona);
  const comoUtc = Date.UTC(
    p['year'],
    p['month'] - 1,
    p['day'],
    p['hour'],
    p['minute'],
    p['second'],
  );
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/**
 * Fecha `YYYY-MM-DD` y hora `HH:mm` de pared de la sede, como instante UTC ISO.
 *
 * <p>Dos pasadas por el desfasaje: la primera estimacion puede caer del otro lado de un cambio de
 * horario, y la segunda la corrige. Devuelve `null` si la fecha o la hora no son validas.
 */
export function instanteDesdeHoraDeSede(fecha: string, hora: string, zona: string): string | null {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  const h = /^(\d{2}):(\d{2})$/.exec(hora);
  if (f === null || h === null) {
    return null;
  }
  const pared = Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3]), Number(h[1]), Number(h[2]));
  if (Number.isNaN(pared)) {
    return null;
  }
  let estimado = pared - desfasaje(new Date(pared), zona);
  estimado = pared - desfasaje(new Date(estimado), zona);
  return new Date(estimado).toISOString();
}

/** Fecha `YYYY-MM-DD` de pared de la sede de un instante. */
export function fechaDeSede(instante: string | undefined, zona: string): string {
  if (!instante) {
    return '';
  }
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) {
    return '';
  }
  const p = partesEnZona(fecha, zona);
  return `${p['year']}-${dos(p['month'])}-${dos(p['day'])}`;
}

/** Hora `HH:mm` de pared de la sede de un instante. */
export function horaDeSede(instante: string | undefined, zona: string): string {
  if (!instante) {
    return '';
  }
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) {
    return '';
  }
  const p = partesEnZona(fecha, zona);
  return `${dos(p['hour'])}:${dos(p['minute'])}`;
}

/** "lunes 12/10, 18:00" en la zona de la sede. */
export function fechaHoraDeSede(instante: string | undefined, zona: string): string {
  const fecha = fechaDeSede(instante, zona);
  if (fecha === '') {
    return '';
  }
  return `${diaEnPalabras(fecha)}, ${horaDeSede(instante, zona)}`;
}

/** "lunes 12/10" de una fecha de calendario `YYYY-MM-DD`. */
export function diaEnPalabras(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  if (!anio || !mes || !dia) {
    return fecha;
  }
  const nombre = new Date(Date.UTC(anio, mes - 1, dia)).toLocaleDateString('es-AR', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  return `${nombre} ${dos(dia)}/${dos(mes)}`;
}

/** Suma dias a una fecha de calendario, sin pasar por ninguna zona. */
export function sumarDiasAFecha(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const resultado = new Date(Date.UTC(anio, mes - 1, dia + dias));
  return resultado.toISOString().slice(0, 10);
}

/** El lunes de la semana de una fecha de calendario. */
export function lunesDeLaSemana(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
  return sumarDiasAFecha(fecha, diaSemana === 0 ? -6 : 1 - diaSemana);
}

/** Los siete dias de la semana que empieza en `lunes`. */
export function diasDeLaSemana(lunes: string): readonly string[] {
  return Array.from({ length: 7 }, (_, i) => sumarDiasAFecha(lunes, i));
}

/** Lugares libres de una clase segun su capacidad efectiva. Nunca negativo. */
export function lugaresLibres(clase: Clase): number {
  const capacidad = clase.capacidadEfectiva ?? clase.capacidad ?? 0;
  return Math.max(0, capacidad - (clase.ocupados ?? 0));
}

function dos(n: number): string {
  return String(n).padStart(2, '0');
}
