import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Motivo por el que fallo una operacion de la cuenta corriente (M18, AKINE-07.01).
 *
 * <p>Se ramifica por `problemType` y <b>nunca</b> por el texto de `detail`, igual que en el resto
 * de las features: `detail` es prosa y cambia cuando alguien corrige una redaccion.
 *
 * <h2>Los tres rechazos de la anulacion llevan a tres salidas distintas</h2>
 *
 * <ul>
 *   <li><b>`obligacion-con-cobros`</b> (409): la deuda ya tiene plata imputada. Viaja con
 *       `yaCobrado`. <b>Lo que no hay que decir es "no se puede"</b>: hay algo que hacer y es
 *       otra cosa. Anular lo ya cobrado dejaria dinero en la caja sin ninguna deuda que lo
 *       justifique y el arqueo del dia no cerraria; lo que corresponde es una <b>devolucion</b>,
 *       que es M19 y tiene su propio registro. Un "no se puede" pelado manda al administrativo a
 *       pedir un permiso que no existe, en vez de al circuito correcto.</li>
 *   <li><b>`obligacion-already-anulada`</b> (409): alguien la anulo antes. No es una falla: el
 *       resultado que se buscaba ya esta. La salida es recargar y mirar el estado real, no
 *       reintentar.</li>
 *   <li><b>`concurrent-modification`</b> (409): la version quedo vieja porque la deuda cambio
 *       entre que se leyo y que se aprieta anular. Nada se pisa, y la salida tambien es
 *       recargar.</li>
 * </ul>
 */
export type CausaObligacion =
  /** 403 missing-tenant-context: hay sesion, pero no hay sede elegida. NUNCA cerrar sesion. */
  | 'sin-contexto'
  /** 403 forbidden: falta `cobro:register` en esta sede. */
  | 'sin-permiso'
  /** 404: la obligacion, la persona o la sede no existen, o son de otro tenant. */
  | 'no-encontrado'
  /** 400: falta el motivo. El backend lo exige y la pantalla tambien. */
  | 'falta-motivo'
  /** 409 `obligacion-con-cobros`: hay plata imputada. Corresponde una devolucion. */
  | 'con-cobros'
  /** 409 `obligacion-already-anulada`: ya estaba anulada. */
  | 'ya-anulada'
  /** 409 `concurrent-modification`: la version quedo vieja. Recargar. */
  | 'version-vieja'
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
export interface ErrorObligacion {
  readonly mensaje: string;
  readonly causa: CausaObligacion;
  /**
   * Lo que ya se cobro sobre esa deuda, cuando el rechazo lo informa. `null` fuera de
   * `con-cobros`, o si el backend no lo mando.
   *
   * <p>Viaja como numero <b>sin formatear</b> a proposito. Formatearlo exige la moneda, y la
   * moneda esta en la obligacion y no en el `ProblemDetail`: quien arma el mensaje final es la
   * pantalla, que tiene las dos cosas. Un `'$ 3.000,00'` armado aca tendria que adivinarla.
   */
  readonly yaCobrado: number | null;
}

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED =
  'No se pudo contactar al servidor, asi que la cuenta corriente que ves puede no estar ' +
  'actualizada. Revisa la conexion y volve a cargar.';
const MENSAJE_LIMITE = 'Demasiados intentos seguidos. Espera un momento y volve a intentar.';

const MENSAJE_SIN_CONTEXTO =
  'Para ver la cuenta corriente hay que saber en que sede estas. Eligi una organizacion y un ' +
  'consultorio, y volve a entrar. Tu sesion sigue abierta.';

const MENSAJE_SIN_PERMISO =
  'No tenes permiso para ver ni anular deudas en esta sede. Pediselo a quien administra el centro.';

const MENSAJE_NO_ENCONTRADO =
  'Esa deuda o esa persona no existen, o no son de esta organizacion. Volve al padron y entra de ' +
  'nuevo.';

const MENSAJE_FALTA_MOTIVO =
  'Falta el motivo de la anulacion, y no es opcional: una deuda que se borra sin explicacion es ' +
  'exactamente lo que una auditoria busca.';

/**
 * `obligacion-already-anulada` no es un fracaso.
 *
 * <p>El estado buscado ya esta. Decirlo asi evita que el administrativo reintente creyendo que
 * algo fallo, y lo manda a lo unico util: mirar el estado real.
 */
const MENSAJE_YA_ANULADA =
  'Esta deuda ya estaba anulada, asi que no habia nada que anular. Recarga la cuenta corriente ' +
  'para ver el estado y el motivo con que se anulo.';

const MENSAJE_VERSION_VIEJA =
  'La deuda cambio despues de que abriste esta pantalla, asi que no la anulamos con datos ' +
  'viejos. No se piso nada: recarga la cuenta corriente y volve a decidir.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripcion de la organizacion esta suspendida, asi que no se pueden anular deudas.';

const MENSAJE_CONFLICTO =
  'El servidor rechazo la operacion por un conflicto con lo que ya hay guardado. Recarga la ' +
  'cuenta corriente para ver el estado actual.';

/**
 * `obligacion-con-cobros` sin el importe: el camino sigue siendo la devolucion.
 *
 * <p>La pantalla enriquece este texto con el importe ya cobrado cuando el backend lo manda. Este
 * es el respaldo, y aun sin el numero dice lo que hay que hacer.
 */
const MENSAJE_CON_COBROS =
  'Esta deuda ya tiene cobros imputados, asi que no se anula: anular lo que ya se cobro dejaria ' +
  'plata en la caja sin ninguna deuda que la justifique y el arqueo del dia no cerraria. Lo que ' +
  'corresponde es registrar una devolucion.';

/** Traduce cualquier error de la cuenta corriente. */
export function traducirErrorObligacion(error: unknown): ErrorObligacion {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: MENSAJE_GENERICO, causa: 'otro', yaCobrado: null };
  }

  if (error.esDeRed) {
    return { mensaje: MENSAJE_DE_RED, causa: 'red', yaCobrado: null };
  }

  if (error.esRateLimited) {
    return { mensaje: MENSAJE_LIMITE, causa: 'limite', yaCobrado: null };
  }

  switch (error.problemType) {
    case 'missing-tenant-context':
      return { mensaje: MENSAJE_SIN_CONTEXTO, causa: 'sin-contexto', yaCobrado: null };
    case 'subscription-suspended':
      return {
        mensaje: MENSAJE_SUSCRIPCION_SUSPENDIDA,
        causa: 'suscripcion-suspendida',
        yaCobrado: null,
      };
    case 'obligacion-con-cobros':
      return {
        mensaje: MENSAJE_CON_COBROS,
        causa: 'con-cobros',
        yaCobrado: error.numeroDeExtension('yaCobrado'),
      };
    case 'obligacion-already-anulada':
      return { mensaje: MENSAJE_YA_ANULADA, causa: 'ya-anulada', yaCobrado: null };
    case 'concurrent-modification':
      return { mensaje: MENSAJE_VERSION_VIEJA, causa: 'version-vieja', yaCobrado: null };
    default:
      break;
  }

  if (error.status === 403) {
    return { mensaje: MENSAJE_SIN_PERMISO, causa: 'sin-permiso', yaCobrado: null };
  }

  if (error.status === 404) {
    // Inexistente y de otro tenant responden igual a proposito: distinguirlos permitiria
    // enumerar deudas ajenas probando ids.
    return { mensaje: MENSAJE_NO_ENCONTRADO, causa: 'no-encontrado', yaCobrado: null };
  }

  if (error.status === 400) {
    return {
      mensaje: conDetalle(error, MENSAJE_FALTA_MOTIVO),
      causa: 'falta-motivo',
      yaCobrado: null,
    };
  }

  if (error.status === 409) {
    return { mensaje: conDetalle(error, MENSAJE_CONFLICTO), causa: 'conflicto', yaCobrado: null };
  }

  return { mensaje: conDetalle(error, MENSAJE_GENERICO), causa: 'otro', yaCobrado: null };
}

/**
 * `true` cuando lo unico util despues del error es volver a leer la cuenta corriente.
 *
 * <p>Los tres casos comparten que la pantalla esta mirando datos viejos: la deuda ya estaba
 * anulada, cambio, o hay un conflicto que no sabemos cual es. Reintentar la misma anulacion con
 * los mismos datos volveria a fallar.
 */
export function hayQueRecargar(causa: CausaObligacion | null): boolean {
  return causa === 'ya-anulada' || causa === 'version-vieja' || causa === 'conflicto';
}

/** El mensaje del backend, o el de respaldo si el cuerpo no traia `ProblemDetail`. */
function conDetalle(error: AkineHttpError, respaldo: string): string {
  return error.problem === null ? respaldo : error.mensaje;
}
