/**
 * Rutas de la cuenta propia (refactor de la cabecera global, 28/10/2026).
 *
 * <p>Las monta `app.routes.ts` y las enlaza el menu del perfil de la barra superior, que vive en
 * `layout/` y no puede importar una pantalla: por eso los strings viven aca y no en cada lado.
 */
export const SEGMENTO_CUENTA = 'mi-cuenta';

export const RUTA_MI_PERFIL = `/${SEGMENTO_CUENTA}/perfil`;

export const RUTA_PREFERENCIAS = `/${SEGMENTO_CUENTA}/preferencias`;
