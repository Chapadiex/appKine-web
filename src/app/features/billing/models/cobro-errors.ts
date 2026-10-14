import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Motivo por el que fallo el registro de un cobro (M19, AKINE-07.02).
 *
 * <p>Mismo criterio que `obligacion-errors.ts`: se ramifica por `problemType` y <b>nunca</b> por
 * el texto de `detail`, que es prosa y cambia cuando alguien corrige una redaccion.
 *
 * <h2>Los cuatro rechazos propios del cobro llevan a cuatro salidas distintas</h2>
 *
 * <ul>
 *   <li><b>`cobro-no-cuadra`</b> (400): los medios o las imputaciones no dan el total. Viaja con
 *       `esperado` y `recibido`, y la pantalla muestra la diferencia. No deberia llegar nunca
 *       —el formulario valida las dos sumas antes de mandar— y por eso importa mostrarlo bien:
 *       si aparece, la que esta mal es la pantalla.</li>
 *   <li><b>`saldo-insuficiente`</b> (409): entre que se leyo la cuenta corriente y que se
 *       confirmo, otro cobro se llevo la plata. <b>Es el que no se puede mostrar como "error
 *       inesperado"</b>: el backend descuenta con `UPDATE ... WHERE saldo >= :importe`
 *       justamente para que el saldo no quede negativo, asi que este rechazo es la garantia
 *       funcionando, no una falla. Viaja con `obligacionId` e `importeIntentado`, y la salida es
 *       recargar la cuenta y volver a componer el cobro.</li>
 *   <li><b>`obligacion-no-cobrable`</b> (409): la deuda esta anulada, ya esta pagada, es de otra
 *       persona o esta en otra moneda. Viaja con `motivo` en texto y no se puede resolver
 *       reintentando: hay que sacar esa deuda del cobro.</li>
 *   <li><b>`idempotency-key-conflict`</b> (409): la misma clave se reuso con otro contenido. No
 *       es culpa del operador y el mensaje lo dice; la salida es reintentar con clave nueva.</li>
 * </ul>
 *
 * <p>Un reintento con la <b>misma</b> clave y el mismo contenido no es un error: el backend
 * devuelve el mismo cobro con el mismo comprobante, con 201, y la pantalla ni se entera. Por eso
 * no hay causa para eso.
 */
export type CausaCobro =
  /** 403 missing-tenant-context: hay sesion, pero no hay sede elegida. NUNCA cerrar sesion. */
  | 'sin-contexto'
  /** 403 forbidden: falta `cobro:register` en esta sede. */
  | 'sin-permiso'
  /** 404: la sede, la persona o el cobro no existen, o son de otro tenant. */
  | 'no-encontrado'
  /** 400 `cobro-no-cuadra`: los medios o las imputaciones no dan el total. */
  | 'no-cuadra'
  /** 409 `saldo-insuficiente`: la deuda ya no tiene ese saldo. El saldo NO queda negativo. */
  | 'saldo-insuficiente'
  /** 409 `obligacion-no-cobrable`: anulada, pagada, de otra persona o en otra moneda. */
  | 'no-cobrable'
  /** 409 `prepago-no-admitido` (E-6): el turno no admite prepago —de otra persona o ya no es una reserva viva—. */
  | 'prepago-no-admitido'
  /** 409 `prepago-ya-registrado` (E-6): el turno ya tiene un prepago vigente. No se cobra dos veces. */
  | 'prepago-ya-registrado'
  /** 409 `idempotency-key-conflict`: la clave se reuso con otro contenido. */
  | 'clave-reusada'
  /** 409 `cobro-anulado` (F-3): el cobro ya estaba anulado. No se opera sobre el dos veces. */
  | 'cobro-anulado'
  /** 409 `cobro-con-reintegros` (F-3): ya devolvio plata; anularlo la sacaria dos veces del cajon. */
  | 'con-reintegros'
  /** 409 `saldo-a-favor-insuficiente` (F-3): el anticipo ya no alcanza. Viaja con `disponible`. */
  | 'saldo-a-favor-insuficiente'
  /** 409 `caja-no-abierta`: la operacion mueve efectivo y la sede no tiene jornada abierta. */
  | 'caja-no-abierta'
  /** 409 `caja-saldo-insuficiente`: devolver ese efectivo dejaria el cajon en negativo. */
  | 'caja-sin-efectivo'
  /** 409 subscription-suspended: lo emite el filtro, antes del controller. */
  | 'suscripcion-suspendida'
  /** 400 de validacion de campos: importe en cero, lista vacia, referencia demasiado larga. */
  | 'datos-invalidos'
  /** Cualquier otro 409. Gana el `detail` del backend. */
  | 'conflicto'
  /** 429: hay que esperar. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/**
 * Que puede hacer el operador despues del rechazo.
 *
 * <p>Existe por la misma razon que en `agenda-errors.ts`: un cartel sin salida deja al
 * administrativo con el paciente enfrente y ninguna accion. Cada accion es un boton distinto.
 */
export type AccionCobro =
  /** La cuenta corriente que se ve quedo vieja: hay que releerla y recomponer el cobro. */
  | 'recargar-cuenta'
  /** Los importes del formulario no cierran. Se corrigen en la pantalla, sin releer nada. */
  | 'corregir-importes'
  /** La clave ya se quemo; el mismo cobro sale bien con una nueva. */
  | 'reintentar-con-clave-nueva'
  /** Falta contexto de trabajo: el unico camino es el selector. */
  | 'elegir-contexto'
  /** El efectivo no tiene donde entrar: hay que abrir la caja de la sede, y el cobro sigue armado. */
  | 'abrir-caja'
  /** No hay nada que ofrecer que no sea volver a intentar mas tarde. */
  | 'ninguna';

/** Error ya traducido a algo mostrable, con los datos que hacen decidible el paso siguiente. */
export interface ErrorCobro {
  readonly mensaje: string;
  readonly causa: CausaCobro;
  readonly accion: AccionCobro;
  /**
   * `cobro-no-cuadra`: el total declarado y lo que el servidor sumo. Los dos, o ninguno.
   *
   * <p>Viajan <b>sin formatear</b> por la misma razon que `yaCobrado` en la anulacion: formatear
   * exige la moneda, y la moneda esta en las obligaciones y no en el `ProblemDetail`.
   */
  readonly esperado: number | null;
  readonly recibido: number | null;
  /** `saldo-insuficiente`: cual deuda y por cuanto se intento. */
  readonly obligacionId: number | null;
  readonly importeIntentado: number | null;
  /** `obligacion-no-cobrable`: por que no admite el cobro, en texto del backend. */
  readonly motivo: string | null;
  /** `prepago-ya-registrado`: el cobro que ya es el prepago vigente del turno. */
  readonly cobroId: number | null;
  /** `saldo-a-favor-insuficiente`: lo que el cobro todavia tenia a favor. Sin formatear. */
  readonly disponible: number | null;
}

/**
 * Que operacion sobre el cobro fallo (F-3).
 *
 * <p>Solo cambia el texto del 403: registrar e imputar piden `cobro:register`, y anular y
 * reintegrar piden ademas `caja:operate`. Decirle "no tenes permiso para registrar cobros" a quien
 * si lo tiene lo manda a pedir lo que ya tiene.
 */
export type OperacionDeCobro = 'registrar' | 'imputar' | 'anular' | 'reintegrar';

const MENSAJE_GENERICO = 'No pudimos registrar el cobro. Volve a intentar en un momento.';
const MENSAJE_DE_RED =
  'No se pudo contactar al servidor, asi que no sabemos si el cobro entro. Revisa la conexion y ' +
  'volve a intentar: la clave de idempotencia hace que reintentar no cobre dos veces.';
const MENSAJE_LIMITE = 'Demasiados intentos seguidos. Espera un momento y volve a intentar.';

const MENSAJE_SIN_CONTEXTO =
  'Para registrar un cobro hay que saber en que sede estas: el comprobante se numera por sede. ' +
  'Eligi una organizacion y un consultorio, y volve a entrar. Tu sesion sigue abierta.';

const MENSAJE_SIN_PERMISO =
  'No tenes permiso para registrar cobros en esta sede. Pediselo a quien administra el centro.';

/**
 * Anular y reintegrar mueven la caja, y por eso piden los dos permisos: el de cobros y el de
 * operar la caja. El mensaje nombra los dos para que se sepa que pedir.
 */
const MENSAJE_SIN_PERMISO_DE_CAJA =
  'Para anular un cobro o devolver un saldo a favor hacen falta dos permisos en esta sede: ' +
  'registrar cobros y operar la caja. Pediselos a quien administra el centro.';

const MENSAJE_COBRO_ANULADO =
  'Ese cobro ya esta anulado, asi que no se hizo nada. Recarga para ver su estado actual.';

const MENSAJE_CON_REINTEGROS =
  'Este cobro ya devolvio parte de su saldo a favor, y anularlo sacaria esa plata dos veces del ' +
  'cajon. No se anulo. Si hay que corregir lo devuelto, se registra un ingreso manual en la caja.';

const MENSAJE_SALDO_A_FAVOR_INSUFICIENTE =
  'El saldo a favor de este cobro ya no alcanza: otra operacion lo uso mientras tanto. No se ' +
  'movio nada. Recarga y volve a armar la operacion con el saldo real.';

const MENSAJE_CAJA_NO_ABIERTA =
  'La caja de esta sede no esta abierta, y esta operacion mueve efectivo del cajon. No se hizo ' +
  'nada: abri la caja en la seccion Caja y volve a intentar.';

const MENSAJE_CAJA_SIN_EFECTIVO =
  'En el cajon no hay efectivo suficiente para esa salida, y un cajon no puede quedar en ' +
  'negativo. No se hizo nada: usa otro medio o revisa la caja.';

const MENSAJE_NO_ENCONTRADO =
  'La sede, la persona o el cobro no existen, o no son de esta organizacion. Volve al padron y ' +
  'entra de nuevo.';

/**
 * `cobro-no-cuadra` no deberia llegar nunca, y por eso el mensaje no culpa al operador.
 *
 * <p>El formulario suma los medios y las imputaciones en centavos enteros y no deja confirmar si
 * alguna de las dos no da el total. Si el servidor igual lo rechaza, lo que fallo es el control
 * local: decirle al operador "revisa los importes" lo manda a buscar un error que no cometio.
 */
const MENSAJE_NO_CUADRA =
  'El servidor sumo los importes y no dan el total declarado, asi que no registro nada. Reviselos ' +
  'y volve a confirmar; si vuelve a pasar con los mismos numeros, es un problema del sistema y no ' +
  'de la carga.';

/**
 * `saldo-insuficiente` es la garantia funcionando, no una falla.
 *
 * <p>El backend descuenta con `UPDATE ... WHERE saldo >= :importe`: el saldo <b>no puede</b>
 * quedar negativo. Cuando eso rechaza, es porque otro cobro se llevo la plata entre que esta
 * pantalla leyo la deuda y que el operador confirmo. Mostrarlo como "error inesperado" haria que
 * el administrativo reintente lo mismo, que va a fallar igual.
 */
const MENSAJE_SALDO_INSUFICIENTE =
  'Esa deuda ya no tiene el saldo que figuraba cuando abriste esta pantalla: alguien cobro antes. ' +
  'No se registro nada y ningun saldo quedo en negativo. Recarga la cuenta corriente y volve a ' +
  'armar el cobro con los saldos reales.';

const MENSAJE_NO_COBRABLE =
  'Una de las deudas elegidas no admite este cobro. Sacala del cobro y confirma el resto: ' +
  'reintentar tal cual va a volver a fallar.';

const MENSAJE_CLAVE_REUSADA =
  'Se reuso la clave de este intento con un cobro distinto, asi que el servidor no aplico nada. ' +
  'No es un error tuyo: volve a confirmar y sale con una clave nueva.';

/**
 * `prepago-no-admitido` (E-6): el turno es de otra persona o ya no es una reserva viva (se
 * atendio, se cancelo, se reprogramo). Reintentar tal cual falla igual; lo util es volver a la
 * recepcion, que relee el dia.
 */
const MENSAJE_PREPAGO_NO_ADMITIDO =
  'Este turno ya no admite un prepago: puede que se haya cancelado, atendido o reprogramado, o que ' +
  'no sea de esta persona. No se registro nada. Volve a la recepcion del dia para ver su estado ' +
  'actual.';

/** `prepago-ya-registrado` (E-6): otro puesto ya cobro el prepago de este turno. */
const MENSAJE_PREPAGO_YA_REGISTRADO =
  'Este turno ya tiene un prepago registrado, asi que no se cobro de nuevo. Si hay que corregirlo, ' +
  'se anula ese cobro desde los cobros del paciente y se registra otro.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripcion de la organizacion esta suspendida, asi que no se pueden registrar cobros.';

const MENSAJE_DATOS_INVALIDOS =
  'El servidor rechazo los datos del cobro. Revisa que cada importe sea mayor que cero y que ' +
  'haya al menos un medio de pago y una deuda elegida.';

const MENSAJE_CONFLICTO =
  'El servidor rechazo el cobro por un conflicto con lo que ya hay guardado. Recarga la cuenta ' +
  'corriente para ver el estado actual antes de volver a intentar.';

/**
 * Traduce cualquier error del circuito de cobros.
 *
 * <p>`operacion` solo elige el texto del 403; todo lo demas se ramifica por `problemType`.
 */
export function traducirErrorCobro(
  error: unknown,
  operacion: OperacionDeCobro = 'registrar',
): ErrorCobro {
  if (!(error instanceof AkineHttpError)) {
    return base(MENSAJE_GENERICO, 'otro', 'ninguna');
  }

  if (error.esDeRed) {
    return base(MENSAJE_DE_RED, 'red', 'ninguna');
  }

  if (error.esRateLimited) {
    return base(MENSAJE_LIMITE, 'limite', 'ninguna');
  }

  switch (error.problemType) {
    case 'missing-tenant-context':
      return base(MENSAJE_SIN_CONTEXTO, 'sin-contexto', 'elegir-contexto');
    case 'subscription-suspended':
      return base(MENSAJE_SUSCRIPCION_SUSPENDIDA, 'suscripcion-suspendida', 'ninguna');
    case 'cobro-no-cuadra':
      return {
        ...base(MENSAJE_NO_CUADRA, 'no-cuadra', 'corregir-importes'),
        esperado: error.numeroDeExtension('esperado'),
        recibido: error.numeroDeExtension('recibido'),
      };
    case 'saldo-insuficiente':
      return {
        ...base(MENSAJE_SALDO_INSUFICIENTE, 'saldo-insuficiente', 'recargar-cuenta'),
        obligacionId: error.numeroDeExtension('obligacionId'),
        importeIntentado: error.numeroDeExtension('importeIntentado'),
      };
    case 'obligacion-no-cobrable':
      return {
        ...base(MENSAJE_NO_COBRABLE, 'no-cobrable', 'recargar-cuenta'),
        motivo: textoDeExtension(error, 'motivo'),
      };
    case 'prepago-no-admitido':
      return {
        ...base(MENSAJE_PREPAGO_NO_ADMITIDO, 'prepago-no-admitido', 'ninguna'),
        motivo: error.problem === null ? null : error.mensaje,
      };
    case 'prepago-ya-registrado':
      return {
        ...base(MENSAJE_PREPAGO_YA_REGISTRADO, 'prepago-ya-registrado', 'ninguna'),
        cobroId: error.numeroDeExtension('cobroId'),
      };
    case 'idempotency-key-conflict':
      return base(MENSAJE_CLAVE_REUSADA, 'clave-reusada', 'reintentar-con-clave-nueva');
    case 'cobro-anulado':
      return base(MENSAJE_COBRO_ANULADO, 'cobro-anulado', 'recargar-cuenta');
    case 'cobro-con-reintegros':
      return base(MENSAJE_CON_REINTEGROS, 'con-reintegros', 'recargar-cuenta');
    case 'saldo-a-favor-insuficiente':
      return {
        ...base(
          MENSAJE_SALDO_A_FAVOR_INSUFICIENTE,
          'saldo-a-favor-insuficiente',
          'recargar-cuenta',
        ),
        disponible: error.numeroDeExtension('disponible'),
        importeIntentado: error.numeroDeExtension('importeIntentado'),
      };
    case 'caja-no-abierta':
      // La salida es abrir la caja, y la pantalla la ofrece con un enlace: el backend lo pide asi en
      // su handler, y sin el enlace el operador se queda con un cartel y el paciente enfrente.
      return base(MENSAJE_CAJA_NO_ABIERTA, 'caja-no-abierta', 'abrir-caja');
    case 'caja-saldo-insuficiente':
      return base(MENSAJE_CAJA_SIN_EFECTIVO, 'caja-sin-efectivo', 'corregir-importes');
    case 'validation-error':
      return base(
        conDetalle(error, MENSAJE_DATOS_INVALIDOS),
        'datos-invalidos',
        'corregir-importes',
      );
    default:
      break;
  }

  if (error.status === 403) {
    const mueveCaja = operacion === 'anular' || operacion === 'reintegrar';
    return base(
      mueveCaja ? MENSAJE_SIN_PERMISO_DE_CAJA : MENSAJE_SIN_PERMISO,
      'sin-permiso',
      'ninguna',
    );
  }

  if (error.status === 404) {
    // Inexistente y de otro tenant responden igual a proposito: distinguirlos permitiria
    // enumerar cobros ajenos probando ids.
    return base(MENSAJE_NO_ENCONTRADO, 'no-encontrado', 'ninguna');
  }

  if (error.status === 400) {
    return base(conDetalle(error, MENSAJE_DATOS_INVALIDOS), 'datos-invalidos', 'corregir-importes');
  }

  if (error.status === 409) {
    return base(conDetalle(error, MENSAJE_CONFLICTO), 'conflicto', 'recargar-cuenta');
  }

  return base(conDetalle(error, MENSAJE_GENERICO), 'otro', 'ninguna');
}

/**
 * `true` cuando el cobro <b>seguro</b> no se registro.
 *
 * <p>Lo usa la pantalla para decidir si puede dejar el formulario cargado. Un fallo de red es el
 * unico caso en el que no se sabe: el pedido pudo haber llegado y la respuesta perderse, y por eso
 * ahi no se limpia nada y se reintenta con la misma clave, que es exactamente para lo que existe.
 */
export function noSeRegistro(causa: CausaCobro): boolean {
  return causa !== 'red';
}

function base(mensaje: string, causa: CausaCobro, accion: AccionCobro): ErrorCobro {
  return {
    mensaje,
    causa,
    accion,
    esperado: null,
    recibido: null,
    obligacionId: null,
    importeIntentado: null,
    motivo: null,
    cobroId: null,
    disponible: null,
  };
}

/** Extension de texto, o `null` si no vino o no es un string. Nunca se muestra cruda otra cosa. */
function textoDeExtension(error: AkineHttpError, clave: string): string | null {
  const valor = error.extension(clave);
  return typeof valor === 'string' && valor !== '' ? valor : null;
}

/** El mensaje del backend, o el de respaldo si el cuerpo no traia `ProblemDetail`. */
function conDetalle(error: AkineHttpError, respaldo: string): string {
  return error.problem === null ? respaldo : error.mensaje;
}
