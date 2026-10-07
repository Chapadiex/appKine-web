import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Traduccion de los rechazos de la caja diaria (M20, AKINE-07.03) a lo que la pantalla hace.
 *
 * <p>Mismo criterio que `cobro-errors.ts`: se decide por `problemType`, nunca por el texto, y el
 * `detail` del backend se muestra cuando no hay un mensaje mejor (AGENT.md 8).
 *
 * <p>`accion` es lo unico que la pantalla necesita para elegir el boton: `recargar` cuando lo que
 * hay en pantalla quedo viejo —otra computadora abrio, cerro o movio la caja—, y `corregir`
 * cuando el operador tiene que cambiar algo de lo que tipeo.
 */
export type AccionCaja = 'recargar' | 'corregir' | 'elegir-contexto' | 'ninguna';

export interface ErrorCaja {
  readonly mensaje: string;
  readonly accion: AccionCaja;
  /** `true` cuando la clave de idempotencia del intento ya no sirve y hay que generar otra. */
  readonly renovarClave?: boolean;
}

const MENSAJE_GENERICO = 'La caja no respondio como se esperaba. Volve a intentar en un momento.';

export function traducirErrorCaja(error: unknown): ErrorCaja {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: MENSAJE_GENERICO, accion: 'ninguna' };
  }
  if (error.esDeRed) {
    return {
      mensaje:
        'No se pudo contactar al servidor, asi que no sabemos si la operacion entro. Recarga la ' +
        'caja antes de repetirla.',
      accion: 'recargar',
    };
  }
  if (error.esRateLimited) {
    return {
      mensaje: 'Demasiados intentos seguidos. Espera un momento y volve a intentar.',
      accion: 'ninguna',
    };
  }

  switch (error.problemType) {
    case 'missing-tenant-context':
      return {
        mensaje:
          'Para operar la caja hay que saber en que sede estas: cada consultorio tiene su cajon. ' +
          'Eligi una organizacion y un consultorio.',
        accion: 'elegir-contexto',
      };
    case 'subscription-suspended':
      return {
        mensaje: 'La suscripcion de la organizacion esta suspendida, asi que la caja no opera.',
        accion: 'ninguna',
      };
    case 'caja-ya-abierta':
      return {
        mensaje: 'Esta sede ya tiene una caja abierta, probablemente desde otra computadora.',
        accion: 'recargar',
      };
    case 'caja-no-abierta':
      return {
        mensaje: 'La caja ya no esta abierta: alguien la cerro mientras tanto.',
        accion: 'recargar',
      };
    case 'caja-cerrada':
      return { mensaje: 'Esta caja ya fue cerrada. Un cierre no se repite.', accion: 'recargar' };
    case 'caja-saldo-cambio':
      return {
        mensaje:
          'Entraron o salieron movimientos en efectivo mientras contabas, asi que el saldo ' +
          'teorico cambio. No se cerro nada: revisa el teorico nuevo y volve a confirmar el arqueo.',
        accion: 'recargar',
      };
    case 'caja-saldo-insuficiente':
      return {
        mensaje:
          'Ese egreso deja el cajon en negativo, y un cajon no puede tener menos de cero. No se ' +
          'registro nada.',
        accion: 'corregir',
      };
    case 'caja-moneda-distinta':
      return {
        mensaje: 'La moneda no coincide con la de la jornada abierta. No se registro nada.',
        accion: 'corregir',
      };
    case 'caja-diferencia-sin-motivo':
      return {
        mensaje: 'El arqueo no cuadra con el teorico: explica la diferencia para poder cerrar.',
        accion: 'corregir',
      };
    case 'movimiento-no-reversible':
      return {
        mensaje:
          'Ese movimiento ya fue revertido o es una reversion, y no se puede revertir de nuevo.',
        accion: 'recargar',
      };
    case 'idempotency-key-conflict':
      return {
        mensaje: 'Se reuso la clave de este intento con otro contenido. Volve a confirmar.',
        accion: 'corregir',
        renovarClave: true,
      };
    default:
      break;
  }

  if (error.status === 403) {
    return {
      mensaje:
        'No tenes permiso para operar la caja de esta sede. Pediselo a quien administra el centro.',
      accion: 'ninguna',
    };
  }
  if (error.status === 400) {
    return {
      mensaje: error.problem === null ? MENSAJE_GENERICO : error.mensaje,
      accion: 'corregir',
    };
  }
  if (error.status === 409) {
    return {
      mensaje: error.problem === null ? MENSAJE_GENERICO : error.mensaje,
      accion: 'recargar',
    };
  }
  return { mensaje: error.problem === null ? MENSAJE_GENERICO : error.mensaje, accion: 'ninguna' };
}
