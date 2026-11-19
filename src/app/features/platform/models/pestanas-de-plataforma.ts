import { Pestana } from '../../../shared/components/pestanas/pestanas';
import {
  RUTA_CATALOGO_FINANCIADORES_DE_PLATAFORMA,
  RUTA_PEDIDOS_DE_PRUEBA_DE_PLATAFORMA,
  RUTA_SOLICITUDES_DE_PLATAFORMA,
  RUTA_SUSCRIPCIONES_DE_PLATAFORMA,
} from './rutas-de-plataforma';

/** `aria-label` de las pestañas de la consola de plataforma. */
export const ETIQUETA_PESTANAS_DE_PLATAFORMA = 'Pantallas de la plataforma';

/**
 * Las pantallas de la consola de plataforma (UX-01). Antes cada una enlazaba a las otras con
 * enlaces sueltos al final de su descripcion; ahora todas muestran las mismas pestanas. El alta de
 * un centro no es pestana: es la accion principal de los pedidos de prueba y de las suscripciones.
 */
/**
 * Desde el 19/11/2026 la consola tiene barra lateral con dos grupos, y cada grupo sus pestañas: antes
 * una sola fila mezclaba centros y catálogo.
 */
export const PESTANAS_DE_CENTROS: readonly Pestana[] = [
  { etiqueta: 'Centros y suscripciones', ruta: RUTA_SUSCRIPCIONES_DE_PLATAFORMA },
  { etiqueta: 'Pedidos de prueba', ruta: RUTA_PEDIDOS_DE_PRUEBA_DE_PLATAFORMA },
];

export const PESTANAS_DE_CATALOGO_DE_PLATAFORMA: readonly Pestana[] = [
  { etiqueta: 'Solicitudes de catálogo', ruta: RUTA_SOLICITUDES_DE_PLATAFORMA },
  { etiqueta: 'Catálogo de financiadores', ruta: RUTA_CATALOGO_FINANCIADORES_DE_PLATAFORMA },
];
