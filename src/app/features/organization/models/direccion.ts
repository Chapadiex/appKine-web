import { PAIS_POR_DEFECTO, nombreDePais } from './paises';

/**
 * Direccion fisica de una sede, en partes (M03, alta de sede con ubicacion, 05/11/2026).
 *
 * <p>Se guarda estructurada y no como un renglon libre: asi se puede buscar por ciudad,
 * geocodificar por partes y mostrarla distinto en un correo y en una tabla. El renglon unico es
 * una PRESENTACION que se arma al leer, nunca lo que se guarda.
 */
export interface DireccionPartes {
  readonly pais?: string | null;
  readonly provincia?: string | null;
  readonly ciudad?: string | null;
  readonly calle?: string | null;
  readonly numero?: string | null;
  readonly codigoPostal?: string | null;
  readonly piso?: string | null;
  readonly referencias?: string | null;
}

function limpio(valor: string | null | undefined): string {
  return (valor ?? '').trim();
}

/** `true` si se cargo algo de la direccion, aunque sea una sola parte. */
export function tieneDireccion(partes: DireccionPartes): boolean {
  return [
    partes.calle,
    partes.numero,
    partes.ciudad,
    partes.provincia,
    partes.codigoPostal,
    partes.piso,
  ].some((parte) => limpio(parte) !== '');
}

/**
 * La direccion en un renglon: "Av. Cabildo 1234, piso 3 of. 301, CABA, Buenos Aires, C1426".
 * Omite lo que falta sin dejar comas colgando, y el pais cuando es Argentina, que es el caso de
 * casi todas las sedes: decirlo seria ruido. Es el MISMO formato que `direccionFormateada` del
 * backend, para que el resumen del alta y el listado digan lo mismo. Vacio si no hay nada cargado.
 */
export function direccionEnUnaLinea(partes: DireccionPartes): string {
  const calleYNumero = [limpio(partes.calle), limpio(partes.numero)].filter((p) => p !== '');
  const ciudad = limpio(partes.ciudad);
  const provincia = limpio(partes.provincia);
  const pais = limpio(partes.pais).toUpperCase();
  return [
    calleYNumero.join(' '),
    limpio(partes.piso),
    ciudad,
    provincia === ciudad ? '' : provincia,
    limpio(partes.codigoPostal),
    pais === '' || pais === PAIS_POR_DEFECTO ? '' : nombreDePais(pais),
  ]
    .filter((tramo) => tramo !== '')
    .join(', ');
}

/**
 * Lo que se le manda al geocodificador: calle y numero, ciudad y provincia. Sin piso ni
 * referencias, que confunden a cualquier buscador de direcciones.
 */
export function consultaParaGeocodificar(partes: DireccionPartes): string {
  const calleYNumero = [limpio(partes.calle), limpio(partes.numero)].filter((p) => p !== '');
  return [calleYNumero.join(' '), limpio(partes.ciudad), limpio(partes.provincia)]
    .filter((tramo) => tramo !== '')
    .join(', ');
}
