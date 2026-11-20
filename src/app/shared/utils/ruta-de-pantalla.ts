/**
 * La ruta de la pantalla sin query ni fragmento. Lo que viaja al backend para el manual y el asistente:
 * el backend sólo usa la pantalla, y la query puede llevar datos de quien mira (un nombre buscado).
 */
export function rutaDePantalla(url: string): string {
  return url.split(/[?#]/)[0];
}
