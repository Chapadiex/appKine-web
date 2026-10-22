import { Pestana } from '../../../shared/components/pestanas/pestanas';
import {
  RUTA_CATALOGO_FINANCIADORES_DE_PLATAFORMA,
  RUTA_SOLICITUDES_DE_PLATAFORMA,
  RUTA_SUSCRIPCIONES_DE_PLATAFORMA,
} from './rutas-de-plataforma';

/** `aria-label` de las pestanas de la consola de plataforma. */
export const ETIQUETA_PESTANAS_DE_PLATAFORMA = 'Pantallas de la plataforma';

/**
 * Las tres pantallas de la consola de plataforma (UX-01). Antes cada una enlazaba a las otras dos
 * con enlaces sueltos al final de su descripcion; ahora las tres muestran las mismas pestanas.
 */
export const PESTANAS_DE_PLATAFORMA: readonly Pestana[] = [
  { etiqueta: 'Solicitudes de catalogo', ruta: RUTA_SOLICITUDES_DE_PLATAFORMA },
  { etiqueta: 'Suscripciones', ruta: RUTA_SUSCRIPCIONES_DE_PLATAFORMA },
  { etiqueta: 'Catalogo de financiadores', ruta: RUTA_CATALOGO_FINANCIADORES_DE_PLATAFORMA },
];
