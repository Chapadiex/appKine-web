import { ParticipanteOperativo } from '../../../api/generated/model/participante-operativo';
import {
  RegistrarAsistencia,
  RegistrarAsistenciaResultadoEnum,
} from '../../../api/generated/model/registrar-asistencia';

/**
 * Vocabulario y reglas de presentacion de la asistencia de clases (M28/M13, AKINE-08.03).
 *
 * <p><b>Asistencia no es Sesion.</b> Marcar a alguien presente registra que estuvo en la clase:
 * no abre una atencion clinica (RN-M28-007) ni genera deuda. Por eso ninguna etiqueta de aca habla
 * de "atender" ni de "cobrar".
 */
export type ResultadoAsistencia = `${RegistrarAsistenciaResultadoEnum}`;

export const RESULTADOS: readonly {
  readonly valor: ResultadoAsistencia;
  readonly etiqueta: string;
}[] = [
  { valor: 'PRESENTE', etiqueta: 'Presente' },
  { valor: 'PRESENTE_TARDE', etiqueta: 'Llego tarde' },
  { valor: 'AUSENTE', etiqueta: 'Ausente' },
];

export function etiquetaDeResultado(resultado: string | undefined): string {
  return RESULTADOS.find((r) => r.valor === resultado)?.etiqueta ?? 'Sin marcar';
}

const ESTADOS_DE_CLASE: Readonly<Record<string, string>> = {
  PROGRAMADA: 'Programada',
  EN_CURSO: 'En curso',
  REALIZADA: 'Realizada',
  CANCELADA: 'Cancelada',
};

export function etiquetaDeEstadoDeClase(estado: string | undefined): string {
  return (estado && ESTADOS_DE_CLASE[estado]) || 'Sin estado';
}

const ESTADOS_DE_INSCRIPCION: Readonly<Record<string, string>> = {
  RESERVADA: 'Reservada',
  CONFIRMADA: 'Confirmada',
  ASISTIO: 'Asistio',
  AUSENTE: 'Ausente',
  CANCELADA: 'Cancelada',
  LISTA_ESPERA: 'En lista de espera',
};

export function etiquetaDeEstadoDeInscripcion(estado: string | undefined): string {
  return (estado && ESTADOS_DE_INSCRIPCION[estado]) || 'Sin estado';
}

const TIPOS_DE_EVENTO: Readonly<Record<string, string>> = {
  REGISTRO: 'Registro',
  CORRECCION: 'Correccion',
};

export function etiquetaDeEvento(tipo: string | undefined): string {
  return (tipo && TIPOS_DE_EVENTO[tipo]) || 'Evento';
}

/** La clase admite marcar: en curso, o ya realizada (las correcciones llegan despues). */
export function admiteAsistencia(estado: string | undefined): boolean {
  return estado === 'EN_CURSO' || estado === 'REALIZADA';
}

/** Solo una inscripcion con lugar se marca: la cancelada y la de lista de espera, no. */
export function tieneLugar(participante: ParticipanteOperativo): boolean {
  const estado = participante.inscripcion?.estado;
  return estado !== 'CANCELADA' && estado !== 'LISTA_ESPERA';
}

export function nombreDeParticipante(participante: ParticipanteOperativo): string {
  const nombre = [participante.apellido, participante.nombre].filter(Boolean).join(', ');
  return nombre || `Inscripcion ${participante.inscripcion?.id ?? ''}`.trim();
}

/** Lo que el operador eligio para un participante, antes de guardar. */
export interface Marca {
  readonly resultado: ResultadoAsistencia;
  readonly motivo: string;
}

/**
 * `true` si la marca cambia un hecho ya registrado: es una correccion y el backend exige motivo.
 */
export function esCorreccion(participante: ParticipanteOperativo, marca: Marca): boolean {
  const actual = participante.asistencia?.resultado;
  return actual !== undefined && actual !== marca.resultado;
}

/** `true` si la marca no cambia nada: mandarla seria un reintento sin efecto. */
export function esIgualAlRegistrado(participante: ParticipanteOperativo, marca: Marca): boolean {
  return participante.asistencia?.resultado === marca.resultado;
}

/**
 * Arma el lote con lo que CAMBIO. Lo que repite lo registrado no viaja: el backend lo trataria
 * como reintento sin escribir, pero ensuciaria el resumen del lote con "exitosos" que no hicieron
 * nada. Las correcciones llevan su motivo.
 *
 * <p>Tampoco viaja una marca sobre quien <b>ya no tiene lugar</b>: si otro operador cancelo la
 * inscripcion con la pantalla abierta, el lote la rechaza y, despues de releer, la marca no tiene
 * reintento posible. Dejarla pendiente bloquearia el cierre de la clase para siempre.
 */
export function armarLote(
  participantes: readonly ParticipanteOperativo[],
  marcas: ReadonlyMap<number, Marca>,
): RegistrarAsistencia[] {
  const items: RegistrarAsistencia[] = [];
  for (const participante of participantes) {
    const id = participante.inscripcion?.id;
    const marca = id === undefined ? undefined : marcas.get(id);
    if (
      id === undefined ||
      marca === undefined ||
      !tieneLugar(participante) ||
      esIgualAlRegistrado(participante, marca)
    ) {
      continue;
    }
    const item: RegistrarAsistencia = {
      inscripcionId: id,
      resultado: marca.resultado as RegistrarAsistenciaResultadoEnum,
    };
    if (esCorreccion(participante, marca)) {
      item.motivo = marca.motivo.trim();
    }
    items.push(item);
  }
  return items;
}

/** Correcciones del lote que todavia no tienen motivo: se frena antes de salir a la red. */
export function correccionesSinMotivo(
  participantes: readonly ParticipanteOperativo[],
  marcas: ReadonlyMap<number, Marca>,
): number[] {
  return participantes
    .filter((p) => {
      const id = p.inscripcion?.id;
      const marca = id === undefined ? undefined : marcas.get(id);
      return (
        marca !== undefined && tieneLugar(p) && esCorreccion(p, marca) && marca.motivo.trim() === ''
      );
    })
    .map((p) => p.inscripcion?.id as number);
}

/** `09:00` en la zona dada, o vacio. */
export function horaEnZona(instante: string | undefined, zona: string): string {
  if (!instante) {
    return '';
  }
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) {
    return '';
  }
  const opciones: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  try {
    return new Intl.DateTimeFormat('es-AR', { ...opciones, timeZone: zona || undefined }).format(
      fecha,
    );
  } catch {
    return new Intl.DateTimeFormat('es-AR', opciones).format(fecha);
  }
}

/** `14/10/2026 09:00` en la zona dada, o vacio. */
export function fechaHoraEnZona(instante: string | undefined, zona: string): string {
  if (!instante) {
    return '';
  }
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) {
    return '';
  }
  const opciones: Intl.DateTimeFormatOptions = {
    dateStyle: 'short',
    timeStyle: 'short',
    hourCycle: 'h23',
  };
  try {
    return new Intl.DateTimeFormat('es-AR', { ...opciones, timeZone: zona || undefined }).format(
      fecha,
    );
  } catch {
    return new Intl.DateTimeFormat('es-AR', opciones).format(fecha);
  }
}

/** `Ausente a Presente — motivo: ...`, o solo el resultado nuevo en un registro. */
export function descripcionDeEvento(evento: {
  resultadoAnterior?: string;
  resultadoNuevo?: string;
  motivo?: string;
}): string {
  const nuevo = etiquetaDeResultado(evento.resultadoNuevo);
  const cambio = evento.resultadoAnterior
    ? `${etiquetaDeResultado(evento.resultadoAnterior)} a ${nuevo}`
    : nuevo;
  return evento.motivo ? `${cambio} — motivo: ${evento.motivo}` : cambio;
}
