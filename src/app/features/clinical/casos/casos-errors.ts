import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { requiereJustificacion } from '../models/historia-errors';

/**
 * Por que fallo un pedido de casos clinicos (D-b, M10).
 *
 * <p>Cada causa lleva a una accion distinta: `requiere-justificacion` pide el motivo de la visita,
 * `posible-duplicado` ofrece confirmar, `version-vieja` pide releer, `caso-cerrado` ofrece reabrir.
 * Por eso no se colapsan en un "error" generico.
 */
export type CausaCaso =
  | 'requiere-justificacion'
  | 'validacion'
  | 'sin-contexto'
  | 'sin-permiso'
  | 'no-encontrado'
  | 'version-vieja'
  | 'caso-cerrado'
  | 'posible-duplicado'
  | 'oferta-no-vigente'
  | 'suscripcion-suspendida'
  | 'conflicto'
  | 'limite'
  | 'red'
  | 'otro';

export interface ErrorCaso {
  readonly causa: CausaCaso;
  readonly mensaje: string;
}

const MENSAJES: Readonly<Record<CausaCaso, string>> = {
  'requiere-justificacion':
    'No figura que atiendas a esta persona en esta sede: para ver o cambiar sus casos tenés que ' +
    'declarar el motivo del acceso.',
  validacion: 'El servidor rechazo un dato del caso clínico. Revisa los campos y volvé a intentar.',
  'sin-contexto':
    'Para trabajar con casos clínicos hay que saber en que sede estas. Eligi una organización y un ' +
    'consultorio, y volvé a entrar. Tu sesión sigue abierta.',
  'sin-permiso':
    'No tenés permiso para esta operación en esta sede. Pediselo a quien administra el centro.',
  'no-encontrado':
    'Ese caso no existe o no es de esta organización. Volvé a la historia clínica para ver los casos.',
  'version-vieja':
    'Alguien cambio este caso después de que lo abriste. No pisamos nada y no perdimos lo que ' +
    'escribiste: relee el caso y volvé a intentar sobre la versión nueva.',
  'caso-cerrado':
    'Este caso esta cerrado y no admite cambios. Si hay que retomarlo, primero reabrilo con motivo.',
  'posible-duplicado':
    'Ya hay un caso activo de la misma oferta para esta persona. Revisalo antes de crear otro: si ' +
    'de todas formas corresponde uno nuevo, confirma para seguir.',
  'oferta-no-vigente':
    'Esa oferta no esta vigente hoy en esta sede, así que no puede motivar un caso. Elegí otra.',
  'suscripcion-suspendida':
    'La suscripción de la organización esta suspendida, así que no se pueden gestionar casos clínicos.',
  conflicto:
    'El servidor rechazo la operación por un conflicto con lo que ya hay guardado. Relee el caso ' +
    'para ver el estado actual.',
  limite: 'Demasiados intentos seguidos. Espera un momento y volvé a intentar.',
  red:
    'No se pudo contactar al servidor, así que lo último que hiciste todavía no esta guardado. ' +
    'Revisa la conexion y volvé a intentar.',
  otro: 'No pudimos completar la operación. Volvé a intentar en un momento.',
};

/** Las causas en las que el `detail` del backend dice mas que el mensaje de la pantalla. */
const CON_DETALLE: ReadonlySet<CausaCaso> = new Set(['validacion', 'conflicto']);

export function traducirErrorCaso(error: unknown): ErrorCaso {
  const causa = causaDe(error);
  const detalle =
    CON_DETALLE.has(causa) && error instanceof AkineHttpError && error.problem !== null
      ? error.mensaje
      : undefined;
  return { causa, mensaje: detalle ?? MENSAJES[causa] };
}

/** El error de una causa conocida sin pasar por HTTP, con su mensaje de siempre. */
export function errorDeCausaCaso(causa: CausaCaso): ErrorCaso {
  return { causa, mensaje: MENSAJES[causa] };
}

function causaDe(error: unknown): CausaCaso {
  if (!(error instanceof AkineHttpError)) return 'otro';
  if (error.esDeRed) return 'red';
  if (error.esRateLimited) return 'limite';
  if (requiereJustificacion(error)) return 'requiere-justificacion';

  switch (error.problemType) {
    case 'missing-tenant-context':
      return 'sin-contexto';
    case 'subscription-suspended':
      return 'suscripcion-suspendida';
    case 'concurrent-modification':
      return 'version-vieja';
    case 'caso-clinico-posible-duplicado':
      return 'posible-duplicado';
    case 'caso-clinico-cerrado':
      return 'caso-cerrado';
    case 'caso-clinico-no-accesible':
    case 'not-found':
      // Inexistente y de otro tenant responden igual a proposito: distinguirlos permitiria
      // enumerar casos ajenos probando ids.
      return 'no-encontrado';
    case 'oferta-no-vigente':
      return 'oferta-no-vigente';
    case 'caso-sin-motivo-de-cierre':
    case 'validation-error':
      return 'validacion';
    default:
      break;
  }
  if (error.status === 403) return 'sin-permiso';
  if (error.status === 404) return 'no-encontrado';
  if (error.status === 409) return 'conflicto';
  if (error.status === 400) return 'validacion';
  return 'otro';
}
