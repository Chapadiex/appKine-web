import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Por que fallo leer o cambiar la suscripcion de un centro desde la consola de plataforma (D3 del
 * pre-QA del 14/10, `appKine-api` #133).
 *
 * <p>Cada causa pide otra cosa: `version-vieja` se resuelve releyendo (la pantalla lo hace sola),
 * `suspendida` no se resuelve desde aca y `no-encontrada` es volver a buscar el centro.
 */
export type CausaSuscripcion =
  /** 409 concurrent-modification: otro cambio movio la version entre la lectura y el envio. */
  | 'version-vieja'
  /** 409 subscription-suspended: el cambio de plan exige la suscripcion ACTIVA. */
  | 'suspendida'
  /** 404: la organizacion no existe o esta dada de baja, o el plan no es contratable. */
  | 'no-encontrada'
  /** 403: la cuenta ya no administra la plataforma. */
  | 'sin-permiso'
  | 'validacion'
  | 'red'
  | 'limite'
  | 'otro';

export interface ErrorSuscripcion {
  readonly causa: CausaSuscripcion;
  readonly mensaje: string;
}

const MENSAJES: Readonly<Record<CausaSuscripcion, string>> = {
  'version-vieja':
    'Otro cambio llego a la suscripcion despues de que la leiste. No se aplico nada: volvimos a ' +
    'leerla, revisa como quedo y repeti el cambio si sigue haciendo falta.',
  suspendida:
    'La suscripcion no esta activa, y el plan solo se cambia con la suscripcion activa. ' +
    'Reactivala primero.',
  'no-encontrada':
    'El centro ya no esta vigente (pudo darse de baja), o el plan elegido ya no es contratable.',
  'sin-permiso':
    'Tu cuenta ya no administra la plataforma, asi que no puede ver ni cambiar suscripciones.',
  validacion: 'El servidor rechazo el pedido. Revisa el plan elegido.',
  red: 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.',
  limite: 'Demasiados intentos. Espera un momento antes de volver a intentar.',
  otro: 'No pudimos completar la operacion. Volve a intentar en un momento.',
};

export function traducirErrorSuscripcion(error: unknown): ErrorSuscripcion {
  const causa = causaDe(error);
  const detalle =
    causa === 'validacion' && error instanceof AkineHttpError ? error.problem?.detail : undefined;
  return { causa, mensaje: detalle ?? MENSAJES[causa] };
}

function causaDe(error: unknown): CausaSuscripcion {
  if (!(error instanceof AkineHttpError)) return 'otro';
  if (error.esDeRed) return 'red';
  if (error.esRateLimited) return 'limite';
  switch (error.problemType) {
    case 'concurrent-modification':
      return 'version-vieja';
    case 'subscription-suspended':
      return 'suspendida';
    case 'not-found':
      return 'no-encontrada';
    case 'forbidden':
      return 'sin-permiso';
    case 'validation-error':
      return 'validacion';
  }
  if (error.status === 404) return 'no-encontrada';
  if (error.status === 403) return 'sin-permiso';
  return 'otro';
}
