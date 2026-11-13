import { AkineHttpError } from '../interceptors/error.interceptor';
import { ProblemDetail } from '../../api/generated/model/problem-detail';
import { formatearFecha } from '../../shared/utils/instantes';

/**
 * Con que choca una operacion de agenda, tal como lo publica el backend desde el contrato 0.158.0
 * (disponibilidad central por persona): las extensiones `conflicto*` e `instructor*` del Problem
 * Detail.
 *
 * <p>Vive en `core/` porque la leen tres features que no se importan entre si: la reserva de turnos
 * (`scheduling`), las clases (`activity`) y las aperturas y horarios (`resource`). El tipo es un
 * recorte del `ProblemDetail` generado, no un DTO propio.
 *
 * <p><b>La sede se nombra, nunca se supone.</b> Antes de 0.158.0 las pantallas decian "en esta sede"
 * o "en otra sede" segun comparaban ids; el backend ahora manda el nombre y si es la misma. Si el
 * conflicto es de otra sede y no hay nombre con que decirlo, la descripcion queda vacia y quien la
 * muestra cae al `detail` del servidor, que ya la redacta con la sede real.
 */
export type ConflictoDelProblema = Pick<
  ProblemDetail,
  | 'conflictoTipo'
  | 'conflictoOrigen'
  | 'conflictoConsultorioId'
  | 'conflictoConsultorioNombre'
  | 'conflictoMismaSede'
  | 'conflictoInicio'
  | 'conflictoFin'
  | 'conflictoFecha'
  | 'conflictoHoraDesde'
  | 'conflictoHoraHasta'
  | 'instructorMembershipId'
  | 'instructorNombre'
>;

const TEXTOS = [
  'conflictoTipo',
  'conflictoOrigen',
  'conflictoConsultorioNombre',
  'conflictoInicio',
  'conflictoFin',
  'conflictoFecha',
  'conflictoHoraDesde',
  'conflictoHoraHasta',
  'instructorNombre',
] as const;

const NUMEROS = ['conflictoConsultorioId', 'instructorMembershipId'] as const;

/**
 * Las extensiones de conflicto de un error, o de una fila de `superposiciones`. Las claves que no
 * vinieron, o vinieron con otra forma, quedan afuera: el contrato no garantiza ninguna.
 */
export function conflictoDelProblema(fuente: unknown): ConflictoDelProblema {
  const leer = lector(fuente);
  const conflicto: Record<string, unknown> = {};
  for (const clave of TEXTOS) {
    const valor = leer(clave);
    if (typeof valor === 'string' && valor !== '') {
      conflicto[clave] = valor;
    }
  }
  for (const clave of NUMEROS) {
    const valor = leer(clave);
    if (typeof valor === 'number' && Number.isFinite(valor)) {
      conflicto[clave] = valor;
    }
  }
  const misma = leer('conflictoMismaSede');
  if (typeof misma === 'boolean') {
    conflicto['conflictoMismaSede'] = misma;
  }
  return conflicto as ConflictoDelProblema;
}

/** Cada franja de `superposiciones` (409 `bloque-solapado` de una apertura), o vacio. */
export function superposicionesDelProblema(error: unknown): readonly ConflictoDelProblema[] {
  if (!(error instanceof AkineHttpError)) {
    return [];
  }
  const filas = error.extension('superposiciones');
  return Array.isArray(filas)
    ? filas.filter((f) => typeof f === 'object' && f !== null).map(conflictoDelProblema)
    : [];
}

/**
 * Una clase que un cierre deja sin instructor, de la extension `clases` del 409
 * `bloqueo-con-turnos-afectados` (0.158.0). El contrato la publica como `object` sin tipar: se lee
 * con estas cuatro claves y nada mas —no trae participantes, y no hace falta—.
 */
export interface ClaseAfectadaPorCierre {
  readonly claseId: number;
  /** Ausente en un cierre de toda la sede. */
  readonly instructorMembershipId?: number;
  readonly inicio: string;
  readonly fin: string;
}

/** Las clases afectadas que trae el 409 `bloqueo-con-turnos-afectados`, o vacio. */
export function clasesDelRechazo(error: unknown): readonly ClaseAfectadaPorCierre[] {
  if (!(error instanceof AkineHttpError) || error.problemType !== 'bloqueo-con-turnos-afectados') {
    return [];
  }
  const filas = error.extension('clases');
  if (!Array.isArray(filas)) {
    return [];
  }
  return filas.flatMap((fila: unknown) => {
    const leer = lector(fila);
    const claseId = leer('claseId');
    const inicio = leer('inicio');
    const fin = leer('fin');
    const instructor = leer('instructorMembershipId');
    if (typeof claseId !== 'number' || typeof inicio !== 'string' || typeof fin !== 'string') {
      return [];
    }
    return [
      {
        claseId,
        inicio,
        fin,
        ...(typeof instructor === 'number' ? { instructorMembershipId: instructor } : {}),
      },
    ];
  });
}

/** Como redactar: la zona la sabe quien llama, igual que los nombres de las sedes que conoce. */
export interface FormaDeDescribir {
  /** `HH:mm` de un instante, en la zona de la sede. */
  readonly hora: (instante: string) => string;
  /** `dd/mm/aaaa` de un instante, en la zona de la sede. Sin esto la franja va sin dia. */
  readonly fecha?: (instante: string) => string;
  /** Sede donde se esta operando, para no nombrarla como si fuera ajena. */
  readonly consultorioActual: number | null;
  /** Nombre de una sede por id, entre los contextos de la cuenta; vacio si no la conoce. */
  readonly nombreDeSede?: (consultorioId: number) => string;
}

const QUE: Readonly<Record<string, string>> = {
  TURNO: 'Turno',
  CLASE: 'Clase',
  BLOQUEO: 'Agenda bloqueada',
  AUSENCIA: 'Ausencia registrada',
  CIERRE_DE_SEDE: 'Sede cerrada',
  DISPONIBILIDAD: 'Horario de atención',
};

/** `true` si el conflicto es en otra sede. Sin dato, compara ids. */
export function conflictoEnOtraSede(
  conflicto: ConflictoDelProblema,
  consultorioActual: number | null,
): boolean {
  if (conflicto.conflictoMismaSede !== undefined) {
    return !conflicto.conflictoMismaSede;
  }
  const id = conflicto.conflictoConsultorioId;
  return id !== undefined && id !== 0 && id !== consultorioActual;
}

/** El nombre de la sede del conflicto: el que manda el backend, o el de los contextos. */
export function sedeDelConflicto(
  conflicto: ConflictoDelProblema,
  forma: Pick<FormaDeDescribir, 'nombreDeSede'>,
): string {
  const id = conflicto.conflictoConsultorioId;
  return (
    conflicto.conflictoConsultorioNombre ??
    (id === undefined || forma.nombreDeSede === undefined ? '' : forma.nombreDeSede(id))
  );
}

/**
 * Con que choca, en una linea: "Clase en la sede Norte, 10:00 a 11:00 · instructor Ana Paz".
 *
 * <p>Distingue turno, clase, bloqueo, ausencia, cierre de sede y horario de atencion, y nombra la
 * sede siempre que la sabe —sea esta u otra—. Vacio si no hay `conflictoTipo`, o si el conflicto es
 * de otra sede y no hay con que nombrarla: ahi el `detail` del servidor dice mas que cualquier
 * texto armado aca. Nunca lleva datos del paciente.
 */
export function describirConflicto(
  conflicto: ConflictoDelProblema,
  forma: FormaDeDescribir,
): string {
  const tipo = conflicto.conflictoTipo;
  if (tipo === undefined) {
    return '';
  }
  const sede = sedeDelConflicto(conflicto, forma);
  if (sede === '' && conflictoEnOtraSede(conflicto, forma.consultorioActual)) {
    return '';
  }
  const donde = sede === '' ? '' : tipo === 'CIERRE_DE_SEDE' ? ` (${sede})` : ` en la sede ${sede}`;
  const franja = franjaDelConflicto(conflicto, forma);
  if (sede === '' && franja === '') {
    // "Turno", a secas, no dice nada que el mensaje no diga.
    return '';
  }
  const instructor =
    conflicto.instructorNombre === undefined ? '' : ` · instructor ${conflicto.instructorNombre}`;
  return `${QUE[tipo] ?? 'Conflicto'}${donde}${franja === '' ? '' : `, ${franja}`}${instructor}`;
}

/** "10:00 a 11:00", "15/03/2027 de 10:00 a 11:00" o vacio. */
function franjaDelConflicto(
  conflicto: ConflictoDelProblema,
  { hora, fecha }: Pick<FormaDeDescribir, 'hora' | 'fecha'>,
): string {
  const inicio = conflicto.conflictoInicio;
  if (inicio !== undefined) {
    const fin = conflicto.conflictoFin === undefined ? '' : ` a ${hora(conflicto.conflictoFin)}`;
    const dia = fecha === undefined ? '' : fecha(inicio);
    return `${dia === '' ? '' : `${dia} de `}${hora(inicio)}${fin}`;
  }
  if (conflicto.conflictoHoraDesde !== undefined) {
    const rango = `${conflicto.conflictoHoraDesde} a ${conflicto.conflictoHoraHasta ?? ''}`.trim();
    return conflicto.conflictoFecha === undefined
      ? rango
      : `${formatearFecha(conflicto.conflictoFecha)} de ${rango}`;
  }
  return '';
}

/** Nombre de una sede entre los contextos de la cuenta, o vacio si no la conoce. */
export function nombreDeSede(
  contextos: readonly { readonly consultorioId?: number; readonly consultorioName?: string }[],
  consultorioId: number | undefined,
): string {
  return contextos.find((c) => c.consultorioId === consultorioId)?.consultorioName ?? '';
}

function lector(fuente: unknown): (clave: string) => unknown {
  if (fuente instanceof AkineHttpError) {
    return (clave) => fuente.extension(clave);
  }
  if (typeof fuente === 'object' && fuente !== null) {
    const registro = fuente as Readonly<Record<string, unknown>>;
    return (clave) => registro[clave];
  }
  return () => undefined;
}
