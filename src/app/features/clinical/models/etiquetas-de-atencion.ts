import { EvaluacionPrevia } from '../../../api/generated/model/evaluacion-previa';
import {
  GuardarEvaluacionDolorLateralidadEnum,
  GuardarEvaluacionEvolucionEnum,
  GuardarEvaluacionModoEnum,
} from '../../../api/generated/model/guardar-evaluacion';

/**
 * Textos, opciones y conversiones de la pantalla de atencion (M14, AKINE-06.01 y 06.02).
 *
 * <p>Vive en `features/` y no en `shared/`: sabe que es una evolucion clinica y que es una
 * lateralidad, o sea sabe de dominio.
 */

/** Una opcion de un grupo de eleccion, con su rotulo visible. */
export interface Opcion<T extends string> {
  readonly valor: T;
  readonly etiqueta: string;
}

/**
 * Los cuatro valores de evolucion, en el orden en que se leen.
 *
 * <p><b>`SIN_REFERENCIA` es el de la primera sesion</b> y por eso esta ultimo y rotulado como lo
 * que significa: decir "igual" cuando no hay contra que comparar seria inventar un dato clinico.
 */
export const EVOLUCIONES: readonly Opcion<GuardarEvaluacionEvolucionEnum>[] = [
  { valor: GuardarEvaluacionEvolucionEnum.MEJOR, etiqueta: 'Mejor' },
  { valor: GuardarEvaluacionEvolucionEnum.IGUAL, etiqueta: 'Igual' },
  { valor: GuardarEvaluacionEvolucionEnum.PEOR, etiqueta: 'Peor' },
  { valor: GuardarEvaluacionEvolucionEnum.SIN_REFERENCIA, etiqueta: 'Sin referencia' },
];

/**
 * Las cuatro lateralidades.
 *
 * <p><b>`NO_APLICA` no es lo mismo que dejarlo vacio</b>, y el rotulo lo dice: una zona central no
 * tiene lado. Vacio es "no lo cargue"; `NO_APLICA` es "no corresponde". Fundirlas perderia la
 * unica diferencia que hace consultable el dato.
 */
export const LATERALIDADES: readonly Opcion<GuardarEvaluacionDolorLateralidadEnum>[] = [
  { valor: GuardarEvaluacionDolorLateralidadEnum.IZQUIERDA, etiqueta: 'Izquierda' },
  { valor: GuardarEvaluacionDolorLateralidadEnum.DERECHA, etiqueta: 'Derecha' },
  { valor: GuardarEvaluacionDolorLateralidadEnum.BILATERAL, etiqueta: 'Bilateral' },
  {
    valor: GuardarEvaluacionDolorLateralidadEnum.NO_APLICA,
    etiqueta: 'No aplica (la zona no tiene lado)',
  },
];

/**
 * Zonas corporales sugeridas.
 *
 * <p>Es una <b>sugerencia y no una lista cerrada</b>: el contrato declara `dolorZona` como texto
 * libre, asi que un `select` de valores fijos le impediria al profesional escribir la zona que
 * efectivamente evaluo. Se ofrece como `datalist`, que autocompleta sin bloquear.
 */
export const ZONAS_SUGERIDAS: readonly string[] = [
  'Cervical',
  'Dorsal',
  'Lumbar',
  'Hombro',
  'Codo',
  'Muñeca',
  'Mano',
  'Cadera',
  'Rodilla',
  'Tobillo',
  'Pie',
];

/** La escala visual analogica completa, 0 a 10. */
export const ESCALA_EVA: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Convierte lo que vino en la sesion a la evolucion que se manda al guardar.
 *
 * <p>Existe porque el contrato genera <b>dos enums distintos</b> para el mismo valor:
 * `EvaluacionBase` es lo que se lee y `GuardarEvaluacion` es lo que se escribe. Validar contra el
 * catalogo en vez de castear evita que un valor que este cliente no conoce —el contrato puede
 * sumar uno sin romper nada— viaje de vuelta al servidor como si lo entendieramos.
 */
export function comoEvolucion(valor: unknown): GuardarEvaluacionEvolucionEnum | null {
  return enCatalogo(valor, EVOLUCIONES);
}

/** Misma conversion, para la lateralidad. */
export function comoLateralidad(valor: unknown): GuardarEvaluacionDolorLateralidadEnum | null {
  return enCatalogo(valor, LATERALIDADES);
}

/** Misma conversion, para el modo de carga. `RAPIDA` es el default de la pantalla. */
export function comoModo(valor: unknown): GuardarEvaluacionModoEnum {
  return valor === GuardarEvaluacionModoEnum.COMPLETA
    ? GuardarEvaluacionModoEnum.COMPLETA
    : GuardarEvaluacionModoEnum.RAPIDA;
}

/**
 * Fecha y hora legibles de un instante UTC.
 *
 * <p>Se formatea con la zona del navegador a proposito y no con la de la sede, a diferencia de la
 * agenda: esta pantalla la mira quien esta atendiendo, en la sede, ahora. Ademas la respuesta de
 * la sesion no trae `timezone`, asi que inventarla seria peor.
 */
export function instanteEnPalabras(instante: string | undefined): string {
  if (instante === undefined || instante === '') {
    return '';
  }
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(fecha);
}

/**
 * Resumen de la evaluacion anterior, para ponerlo al lado del campo de dolor.
 *
 * <p><b>Es la razon por la que `previa` viaja dentro de la sesion y no en un endpoint aparte.</b>
 * Mostrar "la vez pasada tenia 7" mientras se carga el dolor de hoy es lo que hace que el
 * profesional registre una evolucion real y no la que recuerda.
 *
 * <p>Devuelve cadena vacia cuando no hay previa: la pantalla dice ahi que es la primera sesion,
 * que es una afirmacion clinica distinta de un espacio en blanco.
 */
export function resumenDePrevia(previa: EvaluacionPrevia | undefined): string {
  if (previa === undefined) {
    return '';
  }
  const partes: string[] = [];
  if (previa.dolorEva !== undefined) {
    partes.push(`dolor ${previa.dolorEva}/10`);
  }
  if (previa.evolucion !== undefined && previa.evolucion !== '') {
    partes.push(`evolucion ${previa.evolucion}`);
  }
  const cuando = instanteEnPalabras(previa.iniciadaEn);
  if (cuando !== '') {
    partes.push(`del ${cuando}`);
  }
  return partes.join(' · ');
}

function enCatalogo<T extends string>(valor: unknown, catalogo: readonly Opcion<T>[]): T | null {
  return catalogo.find((opcion) => opcion.valor === valor)?.valor ?? null;
}
