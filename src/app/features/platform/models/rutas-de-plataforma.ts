/**
 * Rutas de la consola de plataforma (AKINE-A-7).
 *
 * <p>Viven aca y no sueltas en `app.routes.ts` ni en el menu por lo mismo que las de horarios:
 * el segmento que monta la feature y el enlace que la abre tienen que salir del mismo lugar.
 * Importar una constante de strings no rompe el lazy loading.
 */
export const SEGMENTO_PLATAFORMA = 'plataforma';

/** Bandeja de solicitudes al catalogo comun (RF-M06-005). */
export const RUTA_SOLICITUDES_DE_PLATAFORMA = `/${SEGMENTO_PLATAFORMA}/solicitudes`;

/** Suscripcion de un centro y cambio de plan (PLA-06, D3 del pre-QA del 14/10). */
export const RUTA_SUSCRIPCIONES_DE_PLATAFORMA = `/${SEGMENTO_PLATAFORMA}/suscripciones`;
