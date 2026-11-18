import { AkineHttpError } from '../../core/interceptors/error.interceptor';

/**
 * Traducción de los rechazos del dictado a lo que la pantalla hace. Decide el `problemType`,
 * nunca el texto del backend.
 */
export type CausaDictado =
  | 'deshabilitado'
  | 'no-disponible'
  | 'sin-permiso'
  | 'datos-invalidos'
  | 'microfono'
  | 'red'
  | 'otro';

export interface ErrorDictado {
  readonly mensaje: string;
  readonly causa: CausaDictado;
}

const GENERICO = 'No se pudo pasar el dictado a texto. Volvé a intentar en un momento.';

export function traducirErrorDictado(error: unknown): ErrorDictado {
  if (error instanceof DOMException) {
    return {
      mensaje:
        error.name === 'NotAllowedError'
          ? 'El navegador no dio permiso para usar el micrófono. Habilitalo en la configuración del sitio.'
          : 'No se encontró un micrófono para grabar.',
      causa: 'microfono',
    };
  }
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
    case 'dictado-deshabilitado':
      return {
        mensaje: 'El dictado por voz no está habilitado en este centro.',
        causa: 'deshabilitado',
      };
    case 'dictado-no-disponible':
      return {
        mensaje: 'El dictado no está disponible en este momento. Probá de nuevo en unos segundos.',
        causa: 'no-disponible',
      };
    case 'forbidden':
      return { mensaje: 'No tenés permiso para dictar.', causa: 'sin-permiso' };
    case 'validation-error':
      return {
        mensaje: error.detalle || 'No se pudo usar esa grabación. Volvé a grabar.',
        causa: 'datos-invalidos',
      };
    default:
      return { mensaje: GENERICO, causa: 'otro' };
  }
}
