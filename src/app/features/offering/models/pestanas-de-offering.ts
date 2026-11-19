import { Pestana } from '../../../shared/components/pestanas/pestanas';

/** `aria-label` de las pestanas de configuracion de una oferta. */
export const ETIQUETA_PESTANAS_DE_OFERTA = 'Configuración de la actividad';

/** Las cuatro pantallas de configuracion de una oferta; cada una es una ruta propia. */
export function pestanasDeOferta(ofertaId: number): readonly Pestana[] {
  const base = ['/servicios/ofertas', ofertaId];
  return [
    { etiqueta: 'Habilitaciones', ruta: [...base, 'habilitaciones'].join('/'), exacta: true },
    { etiqueta: 'Prácticas', ruta: [...base, 'practicas'].join('/'), exacta: true },
    { etiqueta: 'Precios particulares', ruta: [...base, 'precios'].join('/'), exacta: true },
    { etiqueta: 'Honorarios por clase', ruta: [...base, 'honorarios'].join('/'), exacta: true },
  ];
}

/** `aria-label` de las pestanas de la seccion de servicios. */
export const ETIQUETA_PESTANAS_DE_SERVICIOS = 'Pantallas de servicios';

/**
 * Las dos pantallas hermanas de Servicios (rediseño 19/11/2026): el catálogo (qué existe) y las
 * actividades de la sede (cómo se presta acá), con las mismas etiquetas que la barra lateral.
 * Ninguna de las dos rutas lleva `permissionGuard` (`offering.routes.ts`). Las ofertas no son
 * exactas: sus pantallas de configuración cuelgan de `/servicios/ofertas/:id/...` y la mantienen
 * marcada.
 */
export const PESTANAS_DE_SERVICIOS: readonly Pestana[] = [
  { etiqueta: 'Catálogo de servicios', ruta: '/servicios/catalogo' },
  { etiqueta: 'Actividades de la sede', ruta: '/servicios/ofertas' },
];
