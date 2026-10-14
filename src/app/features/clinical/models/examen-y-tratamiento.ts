import { ParametroDeTratamientoTipoDatoEnum } from '../../../api/generated/model/parametro-de-tratamiento';
import { LadoDeMedicion } from '../services/clinical-api';
import { Opcion } from './etiquetas-de-atencion';

/**
 * Textos y conversiones del examen fisico (AKINE-06.03) y de los tratamientos realizados
 * (AKINE-06.04), compartidos por la atencion, la enmienda y las versiones.
 *
 * <p>Vive en `features/` y no en `shared/`: sabe que es una medicion y que es una practica.
 */

/**
 * Los tres lados de una medicion. <b>BILATERAL no existe</b>: los valores de los dos lados son
 * distintos —ese es el punto de medirlos— y una medicion bilateral son dos mediciones.
 */
export const LADOS_DE_MEDICION: readonly Opcion<LadoDeMedicion>[] = [
  { valor: 'NO_APLICA', etiqueta: 'Sin lado' },
  { valor: 'IZQUIERDA', etiqueta: 'Izquierda' },
  { valor: 'DERECHA', etiqueta: 'Derecha' },
];

/** Tipo de dato de un parametro. Obligatorio: un parametro sin tipo no se puede interpretar. */
export const TIPOS_DE_PARAMETRO: readonly Opcion<ParametroDeTratamientoTipoDatoEnum>[] = [
  { valor: ParametroDeTratamientoTipoDatoEnum.NUMERICO, etiqueta: 'Numero' },
  { valor: ParametroDeTratamientoTipoDatoEnum.TEXTO, etiqueta: 'Texto' },
  { valor: ParametroDeTratamientoTipoDatoEnum.BOOLEANO, etiqueta: 'Si o no' },
];

/**
 * Claves que se sugieren al escribir un parametro (`plan_sesiones.txt` §10.4).
 *
 * <p><b>Son sugerencias y no un esquema</b>: el backend no tiene parametros por practica y la
 * decision de cuales son obligatorios esta abierta. Se escribe la clave que se quiera.
 */
export const CLAVES_SUGERIDAS: readonly string[] = [
  'Intensidad',
  'Frecuencia',
  'Tiempo',
  'Series',
  'Repeticiones',
  'Carga',
  'Asistencia',
];

/** Lo que una medicion o un parametro trae de valor, en cualquiera de sus formas. */
export interface ConValor {
  readonly tipo?: string;
  readonly tipoDato?: string;
  readonly unidad?: string;
  readonly valorNumerico?: number;
  readonly valorTexto?: string;
  readonly valorBooleano?: boolean;
}

/**
 * El valor legible, con su unidad: `90 grados`, `Si`, `edema leve`. Vacio si no hay valor.
 *
 * <p>Se decide por el valor presente y no por el tipo, para que una fila con un tipo que este
 * cliente no conoce se siga leyendo.
 */
export function valorLegible(dato: ConValor | undefined): string {
  if (dato === undefined) {
    return '';
  }
  if (dato.valorNumerico !== undefined && dato.valorNumerico !== null) {
    const numero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 }).format(
      dato.valorNumerico,
    );
    return dato.unidad ? `${numero} ${dato.unidad}` : numero;
  }
  if (dato.valorBooleano !== undefined && dato.valorBooleano !== null) {
    return dato.valorBooleano ? 'Si' : 'No';
  }
  return dato.valorTexto ?? '';
}

/** Rotulo del lado de una medicion. `NO_APLICA` se lee "sin lado". */
export function ladoLegible(lado: string | undefined): string {
  return LADOS_DE_MEDICION.find((opcion) => opcion.valor === lado)?.etiqueta ?? 'Sin lado';
}

/** El lado de una medicion como el tipo cerrado del contrato. Cualquier otra cosa es "sin lado". */
export function comoLado(valor: unknown): LadoDeMedicion {
  return valor === 'IZQUIERDA' || valor === 'DERECHA' ? valor : 'NO_APLICA';
}

/** Cambio entre dos mediciones, con signo: `+5`, `-2,5`. Vacio si no corresponde restar. */
export function deltaLegible(delta: number | undefined): string {
  if (delta === undefined || delta === null) {
    return '';
  }
  const numero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 }).format(
    Math.abs(delta),
  );
  if (delta === 0) {
    return 'Sin cambio';
  }
  return delta > 0 ? `Subio ${numero}` : `Bajo ${numero}`;
}

/**
 * Texto numerico de un input, o `null` si no es un numero.
 *
 * <p>Acepta coma decimal, que es lo que tipea un profesional en es-AR: `12,5` es doce y medio, no
 * un error.
 */
export function numeroDe(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (limpio === '') {
    return null;
  }
  const numero = Number(limpio);
  return Number.isFinite(numero) ? numero : null;
}
