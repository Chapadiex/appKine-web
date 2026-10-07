/**
 * Configuracion de entorno para produccion.
 *
 * `apiBaseUrl` vacio, igual que en desarrollo: las peticiones son relativas. En la imagen
 * Docker las reenvia nginx al backend que indique AKINE_API_URL al arrancar el contenedor
 * (docs/imagen-docker.md). La URL del backend no se compila en el bundle.
 */
export const environment = {
  production: true,
  apiBaseUrl: '',
  contractVersion: '0.67.0',
} as const;
