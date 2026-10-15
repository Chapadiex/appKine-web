/**
 * URLs de la feature `activity`. Las importan `app.routes.ts`, el menu y la agenda —que enlaza a
 * la clase sin importar ningun componente—: una constante de strings no rompe el lazy loading.
 */
export const SEGMENTO_CLASES = 'clases';
export const RUTA_CLASES = `/${SEGMENTO_CLASES}`;
export const SEGMENTO_NUEVA_CLASE = 'nueva';
export const RUTA_NUEVA_CLASE = `${RUTA_CLASES}/${SEGMENTO_NUEVA_CLASE}`;

/** Detalle de una clase, para un `routerLink`. */
export function rutaDeClase(claseId: number): string {
  return `${RUTA_CLASES}/${claseId}`;
}
