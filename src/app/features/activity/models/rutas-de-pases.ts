/**
 * URLs de productos de pack y pases (M29). Las importan `app.routes.ts` y el menu: una constante de
 * strings no rompe el lazy loading.
 *
 * <p>Los pases cuelgan del padron, como la cuenta corriente: la consulta es "que pases tiene
 * <i>fulana</i>", asi que se llega buscando a la persona. El catalogo de productos si es seccion
 * propia: no depende de nadie.
 */
export const SEGMENTO_PRODUCTOS = 'productos';
export const RUTA_PRODUCTOS = `/${SEGMENTO_PRODUCTOS}`;
export const PATRON_PASES_DE_PERSONA = 'pacientes/:personaId/pases';

/** Pases de una persona, para un `routerLink`. */
export function rutaDePasesDePersona(personaId: number): string {
  return `/pacientes/${personaId}/pases`;
}
