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
