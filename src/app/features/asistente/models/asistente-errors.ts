import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Traducción de los rechazos del asistente de datos a lo que la pantalla hace. Decide el
 * `problemType`, nunca el texto del backend.
 */
export type CausaAsistente =
  | 'deshabilitado'
  | 'no-disponible'
  | 'sin-permiso'
  | 'datos-invalidos'
  | 'no-vigente'
  | 'red'
  | 'otro';

export interface ErrorAsistente {
  readonly mensaje: string;
  readonly causa: CausaAsistente;
}

const GENERICO = 'No se pudo completar la consulta. Volvé a intentar en un momento.';

export function traducirErrorAsistente(error: unknown): ErrorAsistente {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: GENERICO, causa: 'otro' };
  }
  if (error.esDeRed) {
    return {
      mensaje: 'No se pudo contactar al servidor. Revisá tu conexión y volvé a intentar.',
      causa: 'red',
    };
  }
  switch (error.problemType) {
    case 'asistente-deshabilitado':
      return {
        mensaje: 'El asistente no está habilitado en este entorno.',
        causa: 'deshabilitado',
      };
    case 'asistente-no-disponible':
      return {
        mensaje:
          'El asistente no está disponible en este momento. Probá de nuevo en unos segundos.',
        causa: 'no-disponible',
      };
    case 'accion-no-vigente':
    case 'not-found':
      return {
        mensaje: 'La propuesta ya no está vigente. Volvé a pedirlo.',
        causa: 'no-vigente',
      };
    case 'acciones-deshabilitadas':
      return {
        mensaje: 'Las acciones del asistente no están habilitadas en este entorno.',
        causa: 'deshabilitado',
      };
    case 'forbidden':
      return { mensaje: 'No tenés permiso para usar el asistente.', causa: 'sin-permiso' };
    case 'validation-error':
      return {
        mensaje: error.detalle || 'La pregunta no es válida. Revisala y volvé a intentar.',
        causa: 'datos-invalidos',
      };
    default:
      return { mensaje: GENERICO, causa: 'otro' };
  }
}
