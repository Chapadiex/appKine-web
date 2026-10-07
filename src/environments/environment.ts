/**
 * Configuracion de entorno para desarrollo local.
 *
 * `apiBaseUrl` vacio es deliberado: las peticiones salen como rutas relativas (`/api/...`)
 * y el proxy de dev (`proxy.conf.json`) las redirige al backend en localhost:8080.
 *
 * Esto evita por construccion la clase de bug mas comun del QA: commitear una URL de
 * localhost apuntando a la maquina de alguien. No hay switch que cambiar antes de probar
 * ni que revertir despues.
 */
export const environment = {
  production: false,
  apiBaseUrl: '',
  /** Version del contrato OpenAPI desde la que se genero `src/app/api/generated`. */
  contractVersion: '0.63.0',
} as const;
