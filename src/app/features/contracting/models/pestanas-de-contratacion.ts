import { Pestana } from '../../../shared/components/pestanas/pestanas';

/** `aria-label` de las pestanas de la seccion de contratacion. */
export const ETIQUETA_PESTANAS_DE_CONTRATACION = 'Pantallas de contratación';

/**
 * Las tres pantallas hermanas de la seccion (UX-01). Antes eran botones secundarios sueltos al
 * principio de cada pantalla; ahora las tres muestran las mismas pestanas y la actual queda
 * marcada. Las pantallas hijas (aranceles, planes, importar, catalogo) cuelgan de la pestana de
 * su padre: `routerLinkActive` la mantiene marcada.
 */
export const PESTANAS_DE_CONTRATACION: readonly Pestana[] = [
  { etiqueta: 'Convenios de la sede', ruta: '/contratacion/convenios' },
  { etiqueta: 'Financiadores', ruta: '/contratacion/financiadores' },
  { etiqueta: 'Arancel efectivo', ruta: '/contratacion/arancel-efectivo' },
];
