/**
 * El `q` de un listado buscado en el servidor (DP-45): el texto sin los espacios de los costados,
 * o `undefined` si queda vacio.
 *
 * <p>Vacio viaja como `undefined` y no como `''`: el cliente generado omite el parametro y el
 * backend distingue "sin busqueda" de "busca la cadena vacia".
 */
export function textoDeBusqueda(texto: string | null | undefined): string | undefined {
  const limpio = texto?.trim() ?? '';
  return limpio === '' ? undefined : limpio;
}
