/**
 * Rutas de la aplicacion que `core/` necesita conocer para redirigir.
 *
 * <p>Viven aca y no en cada guard porque son un <b>acuerdo entre core y features</b>: los
 * guards de `core/` empujan hacia estas rutas y las pantallas de `features/auth` y
 * `features/organization` las montan. Un literal repetido en cinco archivos es la forma
 * mas barata de que un renombre deje al usuario en un 404.
 *
 * <p>`core/` no importa nada de `features/`: solo conoce el string de la URL.
 */
export const RUTA_LOGIN = '/auth/ingresar';

/**
 * Pantalla que explica que la sesion caduco.
 *
 * <p>Existe porque "te mandamos al login" y "tu sesion se cayo a mitad de lo que estabas
 * haciendo" son dos cosas distintas para el usuario: la primera pide credenciales, la
 * segunda explica que se perdio el hilo y devuelve a donde estaba.
 *
 * <p>La usa {@link authInterceptor} cuando el refresh falla y <b>habia</b> sesion antes. Si
 * no la habia -un anonimo que entro por URL directa- el destino es {@link RUTA_LOGIN}: no
 * se le puede decir "se te cayo la sesion" a alguien que nunca la abrio.
 */
export const RUTA_SESION_EXPIRADA = '/auth/sesion-expirada';

/** Pantalla de seleccion de Organizacion + Consultorio (DP-02, paso 2). */
export const RUTA_SELECTOR_CONTEXTO = '/seleccionar-contexto';

/**
 * Query param con el que se recuerda a donde queria ir el usuario.
 *
 * <p>Lo escriben los guards y el interceptor de auth; lo leen la pantalla de login y la de
 * sesion expirada, que lo reenvia al login para no perder el destino en el camino.
 *
 * <p><b>Un solo nombre para todos.</b> Cuando `core/` escribia `volverA` y `features/auth`
 * leia `returnUrl`, el destino se perdia siempre y todo el mundo terminaba en la home: el
 * parametro viajaba pero nadie lo estaba buscando.
 */
export const PARAM_VOLVER_A = 'volverA';

/**
 * Devuelve el destino solo si es una ruta interna; si no, `null`.
 *
 * <p>Un destino que empieza con `http://`, `https://` o `//` sale del sitio: aceptarlo
 * convertiria al login en una <b>redireccion abierta</b> hacia una pagina de phishing con
 * el aspecto de AKINE. El chequeo es de forma, no de lista blanca: cualquier cosa que no
 * arranque con una unica barra se descarta.
 *
 * <p>Vive en `core/` porque el sanitizado tiene que ser el mismo en las tres puntas -guard,
 * interceptor y pantallas-: dos copias divergen el dia que una arregla un caso y la otra no.
 */
export function destinoInterno(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string' || !valor.startsWith('/') || valor.startsWith('//')) {
    return null;
  }
  return valor;
}
