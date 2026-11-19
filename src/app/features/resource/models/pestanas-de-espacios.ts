import { Pestana } from '../../../shared/components/pestanas/pestanas';

/** `aria-label` de las pestanas de espacios. */
export const ETIQUETA_PESTANAS_DE_ESPACIOS = 'Pantallas de espacios';

/**
 * Las dos lecturas de los espacios de la sede (rediseño 19/11/2026): el listado y los habilitados
 * en un período. Ninguna de las dos rutas lleva `permissionGuard` (`resource.routes.ts`), así que
 * las dos pestañas se ven siempre. `/espacios` es exacta: si no, quedaría marcada también en la
 * disponibilidad, que cuelga de ella.
 */
export const PESTANAS_DE_ESPACIOS: readonly Pestana[] = [
  { etiqueta: 'Espacios y boxes', ruta: '/espacios', exacta: true },
  { etiqueta: 'Espacios habilitados', ruta: '/espacios/disponibilidad' },
];
