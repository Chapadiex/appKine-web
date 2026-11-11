import { Pestana } from '../../../shared/components/pestanas/pestanas';

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
