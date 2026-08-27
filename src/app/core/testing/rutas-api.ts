/**
 * URLs de la API tal como las arma el cliente generado. <b>Solo para tests.</b>
 *
 * <p>Los tests que usan `HttpTestingController` necesitan un string para casar el request,
 * y ese string no existe en el codigo de produccion: el cliente generado lo construye
 * adentro y no lo exporta. Escribirlo suelto en cada spec deja el mismo literal repetido en
 * tres archivos, y el dia que el contrato mueva la ruta fallan las aserciones sin decir por
 * que.
 *
 * <p><b>Esto NO es un DTO manual ni una constante de produccion.</b> Vive en `core/testing`
 * junto al helper de axe, no lo importa ninguna pantalla, y no participa de ninguna
 * llamada: quien llama es el servicio generado. Es la expectativa del test sobre lo que ese
 * servicio hace, expresada una sola vez.
 *
 * <p>Va sin `basePath` porque `environment.apiBaseUrl` esta vacio a proposito (AGENT.md
 * seccion 9): las peticiones son relativas y el proxy de dev las resuelve.
 */
export const RUTA_PERMISOS_EFECTIVOS = '/api/v1/me/permissions';

/**
 * Vinculos de una organizacion. Alimenta el selector de profesional de los horarios.
 */
export function rutaMemberships(orgId: number): string {
  return `/api/v1/organizations/${orgId}/memberships`;
}

/**
 * Bloques de disponibilidad de un profesional en una sede (M05, AKINE-02.04).
 *
 * <p>Ojo: <b>no</b> cuelga de `/organizations/{orgId}`. La organizacion sale del token, y la
 * ruta empieza en la sede. Escribirla de memoria siguiendo el patron de espacios da una URL
 * que no existe y un test que falla sin decir por que.
 */
export function rutaBloquesDisponibilidad(consultorioId: number, membershipId: number): string {
  return `/api/v1/consultorios/${consultorioId}/profesionales/${membershipId}/disponibilidad`;
}

/**
 * Excepciones de disponibilidad de una sede (M05, AKINE-02.04).
 *
 * <p>La baja cuelga de aca con el id de la excepcion, y viaja como `DELETE` <b>con cuerpo</b>:
 * el motivo va en el body para no quedar en los logs de acceso de cualquier proxy.
 */
export function rutaExcepciones(consultorioId: number): string {
  return `/api/v1/consultorios/${consultorioId}/excepciones`;
}

/**
 * Politica de calendario de una sede y feriados de la ventana (M05, AKINE-02.04).
 *
 * <p>La misma URL sirve el `GET` con ventana y el `PUT` de la politica, que no la lleva: los
 * matchers de los specs filtran por metodo, no por query string.
 */
/**
 * Catalogo global de Servicios (M27, AKINE-02.06).
 *
 * <p>No cuelga de `/organizations` ni de `/consultorios`: el `Servicio` es puramente global y no
 * lleva tenant. Escribirla siguiendo el patron de las ofertas da una URL que no existe.
 */
export const RUTA_SERVICIOS = '/api/v1/servicios';

/** Ofertas de una sede (M27, AKINE-02.06). La organizacion sale del token, no de la ruta. */
export function rutaOfertas(consultorioId: number): string {
  return `/api/v1/consultorios/${consultorioId}/ofertas`;
}

export function rutaCalendarioSede(consultorioId: number): string {
  return `/api/v1/consultorios/${consultorioId}/calendario`;
}

/**
 * Disponibilidad efectiva de un profesional en una sede (M05, AKINE-02.04).
 *
 * <p>Es la lectura del RESULTADO, no de las reglas: cuelga del mismo prefijo que los bloques y
 * agrega `/efectiva`. Como toda lectura de este modulo lleva query string, los specs casan con
 * un predicado sobre `request.url` y no con `expectOne(url)`, que compara contra
 * `urlWithParams` y no casaria nunca.
 */
export function rutaDisponibilidadEfectiva(consultorioId: number, membershipId: number): string {
  return `${rutaBloquesDisponibilidad(consultorioId, membershipId)}/efectiva`;
}
