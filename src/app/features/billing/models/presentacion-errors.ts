import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Traduccion de los errores de M21 (presentaciones a financiadores, AKINE-07.04).
 *
 * <p>Sigue el patron de `cobro-errors.ts`: el `problemType` decide la causa y la accion, y el
 * mensaje es el del backend cuando lo hay (AGENT.md §8: "con su mensaje real, no con un
 * generico"). Los textos propios son el respaldo para cuando el servidor no mando detalle.
 *
 * <p>`recargar` dice si la pantalla quedo vieja respecto del servidor —otro operador confirmo,
 * pago o debito antes— y conviene releer el lote antes de reintentar.
 */
export type CausaPresentacion =
  | 'sin-contexto'
  | 'sin-permiso'
  | 'no-encontrado'
  | 'no-editable'
  | 'estado-invalido'
  | 'vacia'
  | 'con-hallazgos'
  | 'ya-presentada'
  | 'no-presentable'
  | 'saldo-insuficiente'
  | 'no-concilia'
  | 'item-no-debitable'
  | 'factura-duplicada'
  | 'caja-no-abierta'
  | 'clave-reusada'
  | 'datos-invalidos'
  | 'conflicto'
  | 'red'
  | 'otro';

export interface ErrorPresentacion {
  readonly mensaje: string;
  readonly causa: CausaPresentacion;
  readonly recargar: boolean;
}

const MENSAJE_GENERICO = 'No se pudo completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED =
  'No se pudo contactar al servidor, asi que no sabemos si la operacion entro. Revisa la ' +
  'conexion y recarga el lote antes de volver a intentar.';
const MENSAJE_SIN_CONTEXTO =
  'Las presentaciones son de una sede. Eligi una organizacion y un consultorio, y volve a ' +
  'entrar. Tu sesion sigue abierta.';
const MENSAJE_SIN_PERMISO =
  'No tenes permiso para gestionar presentaciones en esta sede (hace falta el permiso de ' +
  'cobros). Pediselo a quien administra el centro.';
const MENSAJE_NO_ENCONTRADO =
  'El lote, la prestacion o el financiador no existen, o no son de esta organizacion.';

/** Por tipo: causa, si conviene releer, y el texto de respaldo si el servidor no mando detalle. */
const POR_TIPO: Readonly<Record<string, readonly [CausaPresentacion, boolean, string]>> = {
  'presentacion-no-editable': [
    'no-editable',
    true,
    'El lote ya no es un borrador: alguien lo confirmo o lo descarto. Recargalo.',
  ],
  'presentacion-estado-invalido': [
    'estado-invalido',
    true,
    'El lote no esta en un estado que admita esta operacion. Recargalo para ver como quedo.',
  ],
  'presentacion-vacia': ['vacia', false, 'Un lote sin prestaciones no se puede confirmar.'],
  'presentacion-con-hallazgos': [
    'con-hallazgos',
    true,
    'El lote tiene prestaciones que no se pueden reclamar. Revisalo y quita las observadas.',
  ],
  'obligacion-ya-presentada': [
    'ya-presentada',
    true,
    'Esa prestacion ya esta en otro lote vivo: no se puede reclamar dos veces a la vez.',
  ],
  'obligacion-no-presentable': [
    'no-presentable',
    true,
    'Esa deuda no se le puede reclamar a este financiador.',
  ],
  'presentacion-saldo-insuficiente': [
    'saldo-insuficiente',
    true,
    'El importe supera el saldo del lote. Un pago mayor no esta pagando este lote.',
  ],
  'presentacion-no-concilia': [
    'no-concilia',
    false,
    'Queda saldo sin explicar: registra los debitos o el pago que faltan antes de cerrar.',
  ],
  'item-no-debitable': ['item-no-debitable', true, 'La prestacion ya fue debitada o anulada.'],
  'factura-duplicada': [
    'factura-duplicada',
    false,
    'Ese numero de factura ya esta en otro lote del mismo financiador.',
  ],
  'caja-no-abierta': [
    'caja-no-abierta',
    false,
    'Un pago en efectivo entra a la caja, y no hay una jornada de caja abierta en esta sede.',
  ],
  'idempotency-key-conflict': [
    'clave-reusada',
    false,
    'Se reuso la clave de este intento con datos distintos. Volve a confirmar.',
  ],
  'validation-error': ['datos-invalidos', false, 'El servidor rechazo los datos. Revisalos.'],
};

/** Para cuando la pantalla ni siquiera puede pedir: no hay sede en el contexto. */
export function errorSinContexto(): ErrorPresentacion {
  return { mensaje: MENSAJE_SIN_CONTEXTO, causa: 'sin-contexto', recargar: false };
}

export function traducirErrorPresentacion(error: unknown): ErrorPresentacion {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: MENSAJE_GENERICO, causa: 'otro', recargar: false };
  }
  if (error.esDeRed) {
    return { mensaje: MENSAJE_DE_RED, causa: 'red', recargar: true };
  }
  if (error.faltaContexto) {
    return errorSinContexto();
  }

  const tipo = error.problemType;
  const conocido = tipo === null ? undefined : POR_TIPO[tipo];
  if (conocido !== undefined) {
    const [causa, recargar, respaldo] = conocido;
    return { mensaje: conDetalle(error, respaldo), causa, recargar };
  }

  if (error.status === 403) {
    return { mensaje: MENSAJE_SIN_PERMISO, causa: 'sin-permiso', recargar: false };
  }
  if (error.status === 404) {
    return { mensaje: MENSAJE_NO_ENCONTRADO, causa: 'no-encontrado', recargar: false };
  }
  if (error.status === 400) {
    return {
      mensaje: conDetalle(error, POR_TIPO['validation-error'][2]),
      causa: 'datos-invalidos',
      recargar: false,
    };
  }
  if (error.status === 409) {
    return {
      mensaje: conDetalle(error, 'Conflicto con lo que ya hay guardado. Recarga el lote.'),
      causa: 'conflicto',
      recargar: true,
    };
  }
  return { mensaje: conDetalle(error, MENSAJE_GENERICO), causa: 'otro', recargar: false };
}

function conDetalle(error: AkineHttpError, respaldo: string): string {
  return error.problem?.detail ? error.problem.detail : respaldo;
}
