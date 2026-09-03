/**
 * Configuracion de entorno para produccion.
 *
 * La URL real se inyecta en el build del pipeline; no se versiona apuntando a un host
 * concreto.
 */
export const environment = {
  production: true,
  apiBaseUrl: '',
  contractVersion: '0.29.0',
} as const;
