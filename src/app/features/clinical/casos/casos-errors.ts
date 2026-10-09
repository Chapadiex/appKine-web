import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Motivo por el que fallo una operacion sobre casos clinicos.
 *
 * <p>Se ramifica por `problemType` y <b>nunca</b> por el texto de `detail`, igual que en el resto de
 * las features: `detail` es prosa y cambia cuando alguien corrige una redaccion.
 *
 * <ul>
 *   <li><b>`version-vieja`</b> (409 `concurrent-modification`): otra pestaña guardo antes. No se
 *       pierde nada: la salida es releer el caso (`ver`) y reintentar.</li>
 *   <li><b>`posible-duplicado`</b> (409 `caso-clinico-posible-duplicado`): ya hay un caso parecido
 *       abierto. Se resuelve confirmando con `confirmaPosibleDuplicado: true`.</li>
 *   <li><b>`caso-cerrado`</b> (409): el caso ya esta cerrado y no admite la operacion. <b>No se
 *       reintenta</b>: no hay version con la que vaya a pasar.</li>
 * </ul>
 */
export type CausaCaso =
  /** 400: un dato del caso no es valido. */
  | 'validacion'
  /** 403 missing-tenant-context: hay sesion, pero no hay sede elegida. */
  | 'sin-contexto'
  /** 403 forbidden: falta el permiso en esta sede. */
  | 'sin-permiso'
  /** 404: el caso o la historia clinica no existen, o son de otro tenant. */
  | 'no-encontrado'
  /** 409 `concurrent-modification`: otra pestaña guardo antes. Releer y reintentar. */
  | 'version-vieja'
  /** 409: el caso ya esta cerrado. No hay nada que reintentar. */
  | 'caso-cerrado'
  /** 409 `caso-clinico-posible-duplicado`: ya hay un caso parecido. Confirmar para seguir. */
  | 'posible-duplicado'
  /** 409 subscription-suspended: lo emite el filtro, antes del controller. */
  | 'suscripcion-suspendida'
  /** Cualquier otro 409. Gana el `detail` del backend. */
  | 'conflicto'
  /** 429: hay que esperar. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/** Error ya traducido a algo mostrable. */
export interface ErrorCaso {
  readonly causa: CausaCaso;
  readonly mensaje: string;
}

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED =
  'No se pudo contactar al servidor, asi que lo ultimo que hiciste todavia no esta guardado. ' +
  'Revisa la conexion y volve a intentar.';
const MENSAJE_LIMITE = 'Demasiados intentos seguidos. Espera un momento y volve a intentar.';

const MENSAJE_SIN_CONTEXTO =
  'Para trabajar con casos clinicos hay que saber en que sede estas. Eligi una organizacion y un ' +
  'consultorio, y volve a entrar. Tu sesion sigue abierta.';

const MENSAJE_SIN_PERMISO =
  'No tenes permiso para esta operacion en esta sede. Pediselo a quien administra el centro.';

const MENSAJE_NO_ENCONTRADO =
  'Ese caso o esa historia clinica no existen, o no son de esta sede. Volve a entrar de nuevo.';

const MENSAJE_VERSION_VIEJA =
  'Otra pestaña guardo este caso despues de que vos lo abriste. No pisamos nada y no perdimos lo ' +
  'que hiciste. Volve a abrir el caso para ver el estado actual y reintenta.';

const MENSAJE_POSIBLE_DUPLICADO =
  'Ya hay un caso clinico parecido abierto para esta persona. Revisalo antes de crear otro: si de ' +
  'todas formas corresponde uno nuevo, confirma para seguir.';

const MENSAJE_CASO_CERRADO =
  'Este caso clinico ya esta cerrado, asi que no admite esta operacion. Si hay que retomarlo, ' +
  'primero hay que reabrirlo.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripcion de la organizacion esta suspendida, asi que no se pueden gestionar casos clinicos.';

const MENSAJE_CONFLICTO =
  'El servidor rechazo la operacion por un conflicto con lo que ya hay guardado. Volve a abrir ' +
  'el caso para ver el estado actual.';

const MENSAJE_VALIDACION =
  'El servidor rechazo un dato del caso clinico. Revisa los campos y volve a intentar.';

/** Traduce cualquier error de una operacion de casos clinicos. */
export function traducirErrorCaso(error: unknown): ErrorCaso {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: MENSAJE_GENERICO, causa: 'otro' };
  }

  if (error.esDeRed) {
    return { mensaje: MENSAJE_DE_RED, causa: 'red' };
  }

  if (error.esRateLimited) {
    return { mensaje: MENSAJE_LIMITE, causa: 'limite' };
  }

  switch (error.problemType) {
    case 'missing-tenant-context':
      return { mensaje: MENSAJE_SIN_CONTEXTO, causa: 'sin-contexto' };
    case 'subscription-suspended':
      return { mensaje: MENSAJE_SUSCRIPCION_SUSPENDIDA, causa: 'suscripcion-suspendida' };
    case 'concurrent-modification':
      return { mensaje: MENSAJE_VERSION_VIEJA, causa: 'version-vieja' };
    case 'caso-clinico-posible-duplicado':
      return { mensaje: MENSAJE_POSIBLE_DUPLICADO, causa: 'posible-duplicado' };
    case 'caso-sin-motivo-de-cierre':
      return { mensaje: conDetalle(error, MENSAJE_VALIDACION), causa: 'validacion' };
    default:
      break;
  }

  if (error.status === 403) {
    return { mensaje: MENSAJE_SIN_PERMISO, causa: 'sin-permiso' };
  }

  if (error.status === 404) {
    // Inexistente y de otro tenant responden igual a proposito: distinguirlos permitiria
    // enumerar casos ajenos probando ids.
    return { mensaje: MENSAJE_NO_ENCONTRADO, causa: 'no-encontrado' };
  }

  if (error.status === 409) {
    if (error.problemType) {
      // Cualquier otro 409 con problemType no reconocido. Gana el detail del backend.
      return { mensaje: conDetalle(error, MENSAJE_CONFLICTO), causa: 'conflicto' };
    }
    // El 409 de caso cerrado no trae un problemType propio: cae aca. No se reintenta.
    return { mensaje: conDetalle(error, MENSAJE_CASO_CERRADO), causa: 'caso-cerrado' };
  }

  if (error.status === 400) {
    return { mensaje: conDetalle(error, MENSAJE_VALIDACION), causa: 'validacion' };
  }

  return { mensaje: conDetalle(error, MENSAJE_GENERICO), causa: 'otro' };
}

/** El mensaje del backend, o el de respaldo si el cuerpo no traia `ProblemDetail`. */
function conDetalle(error: AkineHttpError, respaldo: string): string {
  return error.problem === null ? respaldo : error.mensaje;
}
