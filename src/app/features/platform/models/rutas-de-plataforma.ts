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

/** Catalogo global de financiadores y planes (DP-43, U-12). */
export const RUTA_CATALOGO_FINANCIADORES_DE_PLATAFORMA = `/${SEGMENTO_PLATAFORMA}/catalogo-financiadores`;

/** Pedidos de prueba gratis que llegan desde la landing (18/11/2026). */
export const RUTA_PEDIDOS_DE_PRUEBA_DE_PLATAFORMA = `/${SEGMENTO_PLATAFORMA}/pedidos-de-prueba`;

/** Alta de un centro desde la plataforma; con `?solicitud=<id>` aprueba un pedido de prueba. */
export const RUTA_ALTA_DE_CENTRO_DE_PLATAFORMA = `/${SEGMENTO_PLATAFORMA}/centros/nuevo`;
export const RUTA_INICIO_DE_PLATAFORMA = `/${SEGMENTO_PLATAFORMA}/inicio`;
