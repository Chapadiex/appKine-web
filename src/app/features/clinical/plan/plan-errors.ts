import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Motivo por el que fallo una operacion del plan de tratamiento.
 *
 * <p>Se ramifica por `problemType` y status, nunca por el texto de `detail`. Las reglas del
 * plan (no activar sin items, un suspendido no ocupa el lugar del activo) son del backend: el
 * 409 que las expresa se muestra con su `detail`, sin reinterpretarlo.
 */
export type CausaPlan =
  | 'validacion'
  | 'sin-contexto'
  | 'sin-permiso'
  | 'no-encontrado'
  /** 409 concurrent-modification: otra pestaña modifico el plan. Releer. */
  | 'version-vieja'
  /** Cualquier otro 409 (activar sin items, transicion invalida). Gana el `detail`. */
  | 'conflicto'
  | 'limite'
  | 'red'
  | 'otro';

export interface ErrorPlan {
  readonly mensaje: string;
  readonly causa: CausaPlan;
}

const GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';

/** Traduce cualquier error de la pantalla del plan. */
export function traducirErrorPlan(error: unknown): ErrorPlan {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: GENERICO, causa: 'otro' };
  }
  if (error.esDeRed) {
    return {
      mensaje: 'No se pudo contactar al servidor. Revisa la conexion y volve a intentar.',
      causa: 'red',
    };
  }
  if (error.esRateLimited) {
    return { mensaje: 'Demasiados intentos seguidos. Espera un momento.', causa: 'limite' };
  }
  switch (error.problemType) {
    case 'missing-tenant-context':
      return {
        mensaje:
          'Elegi una organizacion y un consultorio para ver el plan. Tu sesion sigue abierta.',
        causa: 'sin-contexto',
      };
    case 'concurrent-modification':
      return {
        mensaje:
          'Otra pestaña modifico este plan despues de que lo abriste. No perdimos lo que ' +
          'escribiste: relee el plan y volve a guardar.',
        causa: 'version-vieja',
      };
    case 'validation-error':
      return {
        mensaje: detalle(error, 'El servidor rechazo un dato del plan.'),
        causa: 'validacion',
      };
    default:
      break;
  }
  switch (error.status) {
    case 403:
      return {
        mensaje: 'No tenes permiso para esta operacion en esta sede.',
        causa: 'sin-permiso',
      };
    case 404:
      return {
        mensaje: 'El plan o el caso no existen, o no son de esta sede.',
        causa: 'no-encontrado',
      };
    case 409:
      return {
        mensaje: detalle(error, 'El servidor rechazo la operacion por un conflicto con el plan.'),
        causa: 'conflicto',
      };
    case 400:
      return {
        mensaje: detalle(error, 'El servidor rechazo un dato del plan.'),
        causa: 'validacion',
      };
    default:
      return { mensaje: GENERICO, causa: 'otro' };
  }
}

function detalle(error: AkineHttpError, porDefecto: string): string {
  const texto = error.problem?.detail;
  return typeof texto === 'string' && texto.trim() ? texto : porDefecto;
}
