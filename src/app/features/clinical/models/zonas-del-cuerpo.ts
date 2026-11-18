import { OpcionChip } from '../../../shared/components/chips/chips';

/**
 * Zonas del cuerpo que se eligen con un toque (modo táctil, 16/11/2026): las de la evaluación de la
 * atención y la zona de una cirugía. Son sugerencias, no un catálogo: "Otra…" deja escribir la que
 * falte.
 */
export const ZONAS_DEL_CUERPO: readonly string[] = [
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

export const OPCIONES_DE_ZONA: readonly OpcionChip[] = ZONAS_DEL_CUERPO.map((zona) => ({
  valor: zona,
  etiqueta: zona,
}));

/** Una zona de texto libre repartida entre el chip elegido y lo escrito en "Otra…". */
export function zonaEnChips(zona: string): { readonly chip: string | null; readonly otra: string } {
  const limpia = zona.trim();
  return ZONAS_DEL_CUERPO.includes(limpia)
    ? { chip: limpia, otra: '' }
    : { chip: null, otra: limpia };
}
