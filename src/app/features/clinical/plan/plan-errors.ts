import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { requiereJustificacion } from '../models/historia-errors';

/**
 * Por que fallo un pedido del Plan de Tratamiento (D-c, M11). Cada causa lleva a una accion:
 * releer, reabrir el caso, ir al plan que ocupa el lugar, elegir otra oferta.
 */
export type CausaPlan =
  | 'requiere-justificacion'
  | 'sin-contexto'
  | 'sin-permiso'
  | 'no-encontrado'
  | 'version-vieja'
  | 'no-editable'
  | 'transicion-invalida'
  | 'plan-vivo'
  | 'caso-no-activo'
  | 'oferta-no-habilitada'
  | 'validacion'
  | 'conflicto'
  | 'limite'
  | 'red'
  | 'otro';

export interface ErrorPlan {
  readonly causa: CausaPlan;
  readonly mensaje: string;
  /** El plan que ocupa el lugar (`plan-vivo-en-el-caso`): la pantalla ofrece ir a el. */
  readonly planQueOcupaId?: number;
}

const MENSAJES: Readonly<Record<CausaPlan, string>> = {
  'requiere-justificacion':
    'No figura que atiendas a esta persona en esta sede: para ver o cambiar su plan tenés que ' +
    'declarar el motivo del acceso.',
  'sin-contexto':
    'Para trabajar con un plan de tratamiento hay que saber en que sede estas. Eligi una ' +
    'organización y un consultorio, y volvé a entrar.',
  'sin-permiso':
    'No tenés permiso para esta operación en esta sede. Pediselo a quien administra el centro.',
  'no-encontrado': 'Ese plan o ese caso no existen, o no son de esta organización.',
  'version-vieja':
    'Alguien cambio este plan después de que lo abriste. No pisamos nada: relee el plan y volvé a ' +
    'intentar sobre la versión nueva.',
  'no-editable':
    'Este plan esta finalizado y no admite cambios. Un plan finalizado no se reabre: crea uno nuevo.',
  'transicion-invalida':
    'El plan ya no esta en un estado que admita esa acción. Relee el plan para ver como quedo.',
  'plan-vivo':
    'El caso ya tiene otro plan vigente que ocupa el lugar. Finalizalo antes de activar este, o ' +
    'reanuda ese.',
  'caso-no-activo':
    'El caso esta cerrado, así que no se puede planificar. Reabrilo con motivo desde el caso.',
  'oferta-no-habilitada':
    'Una de las ofertas del plan no esta habilitada hoy en esta sede. Elegí otra o habilitala.',
  validacion: 'El servidor rechazo un dato del plan. Revisa los campos y volvé a intentar.',
  conflicto:
    'El servidor rechazo la operación por un conflicto con lo que ya hay guardado. Relee el plan.',
  limite: 'Demasiados intentos seguidos. Espera un momento y volvé a intentar.',
  red:
    'No se pudo contactar al servidor, así que lo último que hiciste todavía no esta guardado. ' +
    'Revisa la conexion y volvé a intentar.',
  otro: 'No pudimos completar la operación. Volvé a intentar en un momento.',
};

export function traducirErrorPlan(error: unknown): ErrorPlan {
  const causa = causaDe(error);
  const http = error instanceof AkineHttpError ? error : null;
  const detalle =
    (causa === 'validacion' || causa === 'conflicto') && http?.problem ? http.mensaje : undefined;
  const planQueOcupaId = http?.numeroDeExtension('planQueOcupaId') ?? undefined;
  return {
    causa,
    mensaje: detalle ?? MENSAJES[causa],
    ...(causa === 'plan-vivo' && planQueOcupaId !== undefined ? { planQueOcupaId } : {}),
  };
}

export function errorDeCausaPlan(causa: CausaPlan): ErrorPlan {
  return { causa, mensaje: MENSAJES[causa] };
}

function causaDe(error: unknown): CausaPlan {
  if (!(error instanceof AkineHttpError)) return 'otro';
  if (error.esDeRed) return 'red';
  if (error.esRateLimited) return 'limite';
  if (requiereJustificacion(error)) return 'requiere-justificacion';

  switch (error.problemType) {
    case 'missing-tenant-context':
      return 'sin-contexto';
    case 'concurrent-modification':
      return 'version-vieja';
    case 'plan-no-editable':
      return 'no-editable';
    case 'plan-transicion-invalida':
      return 'transicion-invalida';
    case 'plan-vivo-en-el-caso':
      return 'plan-vivo';
    case 'caso-no-activo':
      return 'caso-no-activo';
    case 'oferta-no-habilitada':
      return 'oferta-no-habilitada';
    case 'plan-no-accesible':
    case 'caso-clinico-no-accesible':
    case 'not-found':
      return 'no-encontrado';
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
