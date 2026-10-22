import { Pestana } from '../../../shared/components/pestanas/pestanas';

/** `aria-label` de las pestanas de primer nivel: catalogo de servicios y ofertas de la sede. */
export const ETIQUETA_PESTANAS_DE_SERVICIOS = 'Servicios y ofertas';

/** Las dos pantallas hermanas de la seccion Servicios. */
export const PESTANAS_DE_SERVICIOS: readonly Pestana[] = [
  { etiqueta: 'Catálogo de servicios', ruta: '/servicios/catalogo', exacta: true },
  { etiqueta: 'Ofertas de la sede', ruta: '/servicios/ofertas', exacta: true },
];

/** `aria-label` de las pestanas de configuracion de una oferta. */
export const ETIQUETA_PESTANAS_DE_OFERTA = 'Configuración de la oferta';

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
