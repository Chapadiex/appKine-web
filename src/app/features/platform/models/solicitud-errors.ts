import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Por que fallo una operacion de la bandeja de solicitudes (AKINE-A-7, RF-M06-005).
 *
 * <p>No reusa `catalog/models/catalogo-errors.ts`: un feature no importa de otro (AGENT.md 4) y,
 * sobre todo, los mismos `problemType` significan otra cosa aca. Para un centro, `catalogo-code-
 * taken` es "cambia el codigo de tu concepto"; para la plataforma que aprueba, es "el catalogo
 * comun ya tiene eso, y la solicitud <b>sigue pendiente</b>" (CA-M06-005-04). Decirlo es lo que
 * evita que alguien crea que aprobo.
 */
export type CausaSolicitud =
  /** 409 catalogo-code-taken al publicar. La solicitud sigue PENDIENTE. */
  | 'codigo-tomado'
  /** 409 catalogo-name-taken al publicar. La solicitud sigue PENDIENTE. */
  | 'nombre-tomado'
  /** 409 catalogo-reference-inactive: la especialidad elegida esta de baja. */
  | 'especialidad-inactiva'
  /** 409 catalogo-solicitud-ya-resuelta u otra version: alguien llego primero. */
  | 'ya-resuelta'
  /** 403: la cuenta ya no administra la plataforma. */
  | 'sin-permiso'
  /** 404: la solicitud, o la especialidad, no existe. */
  | 'no-encontrado'
  /** 400 validation-error: el backend nombra el campo. */
  | 'validacion'
  | 'red'
  | 'limite'
  | 'otro';

export interface ErrorSolicitud {
  readonly mensaje: string;
  readonly causa: CausaSolicitud;
}

const SIGUE_PENDIENTE =
  'La solicitud sigue pendiente y no se publico nada: corregilo y volve a aprobar, o rechazala ' +
  'con una nota que diga que ya existe.';

const MENSAJES: Readonly<Record<CausaSolicitud, string>> = {
  'codigo-tomado': `El catalogo comun ya tiene un concepto vigente con ese codigo. ${SIGUE_PENDIENTE}`,
  'nombre-tomado': `El catalogo comun ya tiene un concepto vigente con ese nombre. ${SIGUE_PENDIENTE}`,
  'especialidad-inactiva':
    'La especialidad elegida esta dada de baja y no se le puede colgar una practica nueva. Elegi ' +
    'otra. La solicitud sigue pendiente.',
  'ya-resuelta':
    'Otra persona resolvio o modifico esta solicitud mientras la revisabas. Volvimos a leer la ' +
    'bandeja: mira como quedo antes de hacer nada.',
  'sin-permiso':
    'Tu cuenta ya no administra la plataforma, asi que no puede resolver solicitudes. Si es un ' +
    'error, pediselo a otro administrador de plataforma.',
  'no-encontrado':
    'La solicitud o la especialidad elegida ya no existe en el catalogo comun. Recarga la bandeja.',
  validacion: 'Revisa los datos de la resolucion.',
  red: 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.',
  limite: 'Demasiados intentos. Espera un momento antes de volver a intentar.',
  otro: 'No pudimos completar la operacion. Volve a intentar en un momento.',
};

function error(causa: CausaSolicitud, mensaje = MENSAJES[causa]): ErrorSolicitud {
  return { causa, mensaje };
}

/**
 * Traduce cualquier error de la bandeja. Se ramifica por `problemType`, nunca por `detail`.
 *
 * <p>En `400` gana el `detail` del backend: es el que dice que falto —la especialidad de una
 * practica, un codigo posible—, y eso no lo sabe esta pantalla.
 */
export function traducirErrorSolicitud(causa: unknown): ErrorSolicitud {
  if (!(causa instanceof AkineHttpError)) {
    return error('otro');
  }
  if (causa.esDeRed) {
    return error('red');
  }
  if (causa.esRateLimited) {
    return error('limite');
  }

  switch (causa.problemType) {
    case 'catalogo-code-taken':
      return error('codigo-tomado');
    case 'catalogo-name-taken':
      return error('nombre-tomado');
    case 'catalogo-reference-inactive':
      return error('especialidad-inactiva');
    case 'catalogo-solicitud-ya-resuelta':
    case 'concurrent-modification':
      return error('ya-resuelta');
    default:
      break;
  }

  switch (causa.status) {
    case 403:
      return error('sin-permiso');
    case 404:
      return error('no-encontrado');
    case 400:
      return error('validacion', causa.problem === null ? MENSAJES.validacion : causa.message);
    default:
      return error('otro', causa.problem === null ? MENSAJES.otro : causa.message);
  }
}
