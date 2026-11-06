import { DIAS_DE_LA_SEMANA, etiquetaDeDia } from '../../../shared/utils/dias-de-la-semana';

/**
 * Seleccion rapida de dias del formulario de horario del profesional (rediseño del 05/11/2026).
 *
 * <p>Cargar la semana de un profesional era elegir un dia, escribir las horas y repetir cinco
 * veces. Los modos de aca resuelven los casos de casi todos los centros con un clic, y
 * `PERSONALIZADO` deja marcar los dias uno por uno. Lo que viaja al contrato es siempre la lista de
 * numeros ISO (lunes = 1 .. domingo = 7), nunca el nombre del modo.
 */
export type ModoDeDias = 'lv' | 'ls' | 'semana' | 'personalizado';

export interface OpcionDeModo {
  readonly id: ModoDeDias;
  readonly etiqueta: string;
  /** Los dias que fija el modo, o `null` si los elige el usuario. */
  readonly dias: readonly number[] | null;
}

export const MODOS_DE_DIAS: readonly OpcionDeModo[] = [
  { id: 'lv', etiqueta: 'Lunes a viernes', dias: [1, 2, 3, 4, 5] },
  { id: 'ls', etiqueta: 'Lunes a sábado', dias: [1, 2, 3, 4, 5, 6] },
  { id: 'semana', etiqueta: 'Toda la semana', dias: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'personalizado', etiqueta: 'Personalizado', dias: null },
];

/** Los dias que fija un modo, o `null` para el personalizado. */
export function diasDelModo(modo: ModoDeDias): readonly number[] | null {
  return MODOS_DE_DIAS.find((opcion) => opcion.id === modo)?.dias ?? null;
}

/** Rotulo de dos letras de cada dia, para las pastillas: "Lu Ma Mi Ju Vi Sá Do". */
const DIAS_CORTOS: Readonly<Record<number, string>> = {
  1: 'Lu',
  2: 'Ma',
  3: 'Mi',
  4: 'Ju',
  5: 'Vi',
  6: 'Sá',
  7: 'Do',
};

export const DIAS_PARA_PASTILLAS = DIAS_DE_LA_SEMANA.map((dia) => ({
  numero: dia.numero,
  etiqueta: dia.etiqueta,
  corto: DIAS_CORTOS[dia.numero] ?? String(dia.numero),
}));

/** Agrega o quita un dia de la seleccion, devolviendo una lista nueva y ordenada. */
export function alternarDia(dias: readonly number[], dia: number): number[] {
  const conjunto = new Set(dias);
  if (conjunto.has(dia)) {
    conjunto.delete(dia);
  } else {
    conjunto.add(dia);
  }
  return [...conjunto].sort((uno, otro) => uno - otro);
}

/**
 * Los dias redactados para el aviso: "lunes a viernes", "lunes, miércoles y viernes", "domingo".
 *
 * <p>Un tramo consecutivo se dice con "a"; lo demas se enumera. Es texto para humanos, no viaja.
 */
export function describirDias(dias: readonly number[]): string {
  const ordenados = [...dias].sort((uno, otro) => uno - otro);
  if (ordenados.length === 0) {
    return '';
  }
  const nombres = ordenados.map((dia) => etiquetaDeDia(dia).toLowerCase());
  if (ordenados.length === 7) {
    return 'toda la semana';
  }
  const consecutivos = ordenados.every(
    (dia, indice) => indice === 0 || dia === ordenados[indice - 1] + 1,
  );
  if (consecutivos && ordenados.length >= 3) {
    return `${nombres[0]} a ${nombres[nombres.length - 1]}`;
  }
  if (nombres.length === 1) {
    return nombres[0];
  }
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}
