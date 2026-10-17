import {
  NotificationResponseEstadoEnum as EstadoNotificacion,
  NotificationResponseTipoEnum as TipoNotificacion,
} from '../../../api/generated/model/notification-response';

export { EstadoNotificacion, TipoNotificacion };

/**
 * Textos en espanol de los dos enums de notificacion (RF-M26-005).
 *
 * <p>Un `Record` sobre el enum generado y no un `switch` con `default`: si el contrato agrega un
 * tipo o un estado, esto deja de compilar en vez de mostrar el literal crudo en la tabla.
 */
export const TEXTO_TIPO: Readonly<Record<TipoNotificacion, string>> = {
  [TipoNotificacion.ACTIVACION_CUENTA]: 'Activacion de cuenta',
  [TipoNotificacion.INVITACION_COLABORADOR]: 'Invitacion a colaborar',
  [TipoNotificacion.RECUPERACION_PASSWORD]: 'Recuperacion de contrasena',
  [TipoNotificacion.CUENTA_YA_REGISTRADA]: 'Aviso de cuenta ya registrada',
  [TipoNotificacion.CLASE_MODIFICADA]: 'Clase modificada',
  [TipoNotificacion.CUPO_LIBERADO]: 'Cupo liberado',
  [TipoNotificacion.TURNO_RESERVADO]: 'Turno reservado',
  [TipoNotificacion.TURNO_CANCELADO]: 'Turno cancelado',
  [TipoNotificacion.TURNO_REPROGRAMADO]: 'Turno reprogramado',
  [TipoNotificacion.PASE_POR_VENCER]: 'Pase o abono por vencer',
  [TipoNotificacion.PASE_SALDO_BAJO]: 'Pase con pocos creditos',
};

export const TEXTO_ESTADO: Readonly<Record<EstadoNotificacion, string>> = {
  [EstadoNotificacion.PENDIENTE]: 'Pendiente',
  [EstadoNotificacion.PROCESANDO]: 'Enviandose',
  [EstadoNotificacion.ENVIADA]: 'Enviada',
  [EstadoNotificacion.FALLIDA]: 'Fallida',
  [EstadoNotificacion.REINTENTABLE]: 'Esperando reintento automatico',
  [EstadoNotificacion.AGOTADA]: 'Agotada (sin mas intentos)',
};

/** Orden en que se ofrecen los estados en el filtro: primero los que piden accion. */
export const ESTADOS_FILTRABLES: readonly EstadoNotificacion[] = [
  EstadoNotificacion.FALLIDA,
  EstadoNotificacion.AGOTADA,
  EstadoNotificacion.REINTENTABLE,
  EstadoNotificacion.PENDIENTE,
  EstadoNotificacion.PROCESANDO,
  EstadoNotificacion.ENVIADA,
];

/** Lo que el backend lista sin filtro, y lo que la pantalla muestra al entrar. */
export const ESTADOS_POR_DEFECTO: readonly EstadoNotificacion[] = [
  EstadoNotificacion.FALLIDA,
  EstadoNotificacion.AGOTADA,
];

export function textoTipo(tipo: TipoNotificacion | undefined): string {
  return tipo === undefined ? '-' : (TEXTO_TIPO[tipo] ?? tipo);
}

export function textoEstado(estado: EstadoNotificacion | undefined): string {
  return estado === undefined ? '-' : (TEXTO_ESTADO[estado] ?? estado);
}
