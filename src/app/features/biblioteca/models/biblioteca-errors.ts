import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Traduccion de los rechazos de la biblioteca del centro a lo que la pantalla hace.
 *
 * <p>Mismo criterio que `egreso-errors.ts`: decide el `problemType`, nunca el texto del backend,
 * salvo como ultimo recurso. `recargar` dice que lo que hay en pantalla quedo viejo.
 */
export type CausaBiblioteca =
  | 'deshabilitada'
  | 'no-encontrado'
  | 'duplicado'
  | 'archivo-no-aceptado'
  | 'demasiado-grande'
  | 'en-proceso'
  | 'version-vieja'
  | 'datos-invalidos'
  | 'sin-permiso'
  | 'red'
  | 'otro';

export interface ErrorBiblioteca {
  readonly mensaje: string;
  readonly causa: CausaBiblioteca;
  readonly recargar: boolean;
  /** Libro ya existente, cuando `libro-duplicado` lo informa. */
  readonly libroId?: number;
}

const MENSAJE_GENERICO = 'No se pudo completar la operación. Volvé a intentar en un momento.';

export function traducirErrorBiblioteca(error: unknown): ErrorBiblioteca {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: MENSAJE_GENERICO, causa: 'otro', recargar: false };
  }
  if (error.esDeRed) {
    return {
      mensaje: 'No se pudo contactar al servidor. Revisá tu conexión y volvé a intentar.',
      causa: 'red',
      recargar: false,
    };
  }

  switch (error.problemType) {
    case 'biblioteca-deshabilitada':
      return {
        mensaje: 'La biblioteca no está habilitada en este entorno.',
        causa: 'deshabilitada',
        recargar: false,
      };
    case 'libro-no-encontrado':
      return {
        mensaje: 'El libro no existe, o ya no es de esta organización.',
        causa: 'no-encontrado',
        recargar: true,
      };
    case 'libro-duplicado': {
      const libroId = error.numeroDeExtension('libroId');
      return {
        mensaje: 'Ese PDF ya está en la biblioteca.',
        causa: 'duplicado',
        recargar: false,
        ...(libroId === null ? {} : { libroId }),
      };
    }
    case 'libro-archivo-no-aceptado':
      return {
        mensaje: 'El archivo no es un PDF válido.',
        causa: 'archivo-no-aceptado',
        recargar: false,
      };
    case 'libro-en-proceso':
      return {
        mensaje: 'Hay un procesamiento o reemplazo en curso: esperá a que termine.',
        causa: 'en-proceso',
        recargar: false,
      };
    case 'concurrent-modification':
      return {
        mensaje: 'Otra persona cambió este libro. Recargá para ver la versión actual.',
        causa: 'version-vieja',
        recargar: true,
      };
    case 'validation-error':
      return {
        mensaje: error.detalle || 'El servidor rechazó los datos. Revisalos.',
        causa: 'datos-invalidos',
        recargar: false,
      };
    default:
      break;
  }

  if (error.status === 413) {
    return {
      mensaje: 'El archivo supera el tamaño máximo permitido.',
      causa: 'demasiado-grande',
      recargar: false,
    };
  }
  if (error.status === 403) {
    return {
      mensaje:
        'No tenés permiso para administrar la biblioteca. Pediselo a quien administra el centro.',
      causa: 'sin-permiso',
      recargar: false,
    };
  }
  if (error.status === 400) {
    return {
      mensaje: error.detalle || 'El servidor rechazó los datos. Revisalos.',
      causa: 'datos-invalidos',
      recargar: false,
    };
  }
  return { mensaje: error.detalle || MENSAJE_GENERICO, causa: 'otro', recargar: false };
}
