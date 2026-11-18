import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Por que fallo una operacion de contratacion desde la consola: el alta de un centro, el descarte
 * de un pedido de prueba o el cambio de la contratacion de un centro (18/11/2026).
 *
 * <p>El mismo `problemType` quiere decir otra cosa segun la operacion: un 409
 * `concurrent-modification` en el alta o el descarte es "otra persona ya resolvio el pedido"; en la
 * contratacion es "la version quedo vieja". Por eso el mensaje se elige por operacion.
 */
export type OperacionDeContratacion = 'lectura' | 'alta' | 'descarte' | 'contratacion';

export type CausaContratacion =
  | 'conflicto'
  | 'suspendida'
  | 'no-encontrado'
  | 'sin-permiso'
  | 'validacion'
  | 'red'
  | 'limite'
  | 'otro';

export interface ErrorContratacion {
  readonly causa: CausaContratacion;
  readonly mensaje: string;
  /** Errores de validacion por campo del cuerpo, para marcar el formulario. */
  readonly campos: Readonly<Record<string, string>>;
}

const COMUNES: Readonly<Record<'sin-permiso' | 'red' | 'limite' | 'otro', string>> = {
  'sin-permiso': 'Tu cuenta ya no administra la plataforma, así que no puede hacer esto.',
  red: 'No se pudo contactar al servidor. Revisá tu conexión y volvé a intentar.',
  limite: 'Demasiados intentos. Esperá un momento antes de volver a intentar.',
  otro: 'No pudimos completar la operación. Volvé a intentar en un momento.',
};

const POR_OPERACION: Readonly<
  Record<OperacionDeContratacion, Readonly<Record<'conflicto' | 'no-encontrado', string>>>
> = {
  lectura: {
    conflicto: 'El dato cambió mientras lo leíamos. Volvé a intentar.',
    'no-encontrado': 'Ya no existe: pudo darse de baja. Volvé al listado.',
  },
  alta: {
    conflicto:
      'Otra persona ya resolvió ese pedido de prueba (lo aprobó o lo descartó). No se creó ' +
      'ningún centro: volvé a la bandeja para ver cómo quedó.',
    'no-encontrado':
      'El plan elegido ya no se ofrece, o el pedido de prueba ya no existe. No se creó nada.',
  },
  descarte: {
    conflicto:
      'Otra persona ya resolvió este pedido mientras lo revisabas. No se descartó nada: ' +
      'volvimos a leer la bandeja.',
    'no-encontrado': 'El pedido ya no existe. Volvimos a leer la bandeja.',
  },
  contratacion: {
    conflicto:
      'Otro cambio llegó a la contratación después de que la leíste. No se aplicó nada: ' +
      'volvimos a leerla, revisá cómo quedó y repetí el cambio si sigue haciendo falta.',
    'no-encontrado': 'El centro ya no está vigente, o el plan elegido ya no se ofrece.',
  },
};

const SUSPENDIDA =
  'La suscripción está suspendida o cancelada: la contratación no se cambia desde acá.';

export function traducirErrorContratacion(
  error: unknown,
  operacion: OperacionDeContratacion,
): ErrorContratacion {
  const campos = error instanceof AkineHttpError ? error.erroresPorCampo : {};
  const causa = causaDe(error);
  return { causa, mensaje: mensajeDe(error, causa, operacion), campos };
}

function mensajeDe(
  error: unknown,
  causa: CausaContratacion,
  operacion: OperacionDeContratacion,
): string {
  switch (causa) {
    case 'conflicto':
    case 'no-encontrado':
      return POR_OPERACION[operacion][causa];
    case 'suspendida':
      return SUSPENDIDA;
    case 'validacion': {
      const http = error as AkineHttpError;
      return (
        http.mensajeDeCampos ?? http.detalle ?? 'El servidor rechazó el pedido. Revisá los campos.'
      );
    }
    default:
      return COMUNES[causa];
  }
}

function causaDe(error: unknown): CausaContratacion {
  if (!(error instanceof AkineHttpError)) return 'otro';
  if (error.esDeRed) return 'red';
  if (error.esRateLimited) return 'limite';
  switch (error.problemType) {
    case 'concurrent-modification':
      return 'conflicto';
    case 'subscription-suspended':
      return 'suspendida';
    case 'not-found':
      return 'no-encontrado';
    case 'forbidden':
      return 'sin-permiso';
    case 'validation-error':
      return 'validacion';
  }
  if (error.status === 400) return 'validacion';
  if (error.status === 404) return 'no-encontrado';
  if (error.status === 403) return 'sin-permiso';
  if (error.status === 409) return 'conflicto';
  return 'otro';
}
