import { AkineHttpError, AkineProblemType } from '../../../core/interceptors/error.interceptor';

/**
 * Traduccion de los errores de la asistencia de clases (M28/M13, AKINE-08.03).
 *
 * <p><b>El backend no publico tipos nuevos para la asistencia</b>, y es deliberado (ver el
 * `ActivityProblemHandler`): "esta clase no admite asistencia" viaja como
 * `clase-transicion-no-permitida` con su `motivo`, y "esa reserva no tenia lugar" como
 * `inscripcion-transicion-no-permitida`. La correccion sin motivo es un `validation-error` 400.
 * Por eso este traductor se apoya en el `detail` del servidor, que es el que nombra la causa
 * concreta, y solo agrega lo que la pantalla tiene que decir sobre que hacer despues.
 *
 * <p>El lote devuelve un `problemType` por participante —la URI completa, la misma que habria
 * viajado en la operacion individual— y {@link traducirFalloDeItem} lo traduce con el mismo
 * criterio.
 */
export type CausaAsistencia =
  | 'sin-contexto'
  | 'sin-permiso'
  | 'no-encontrado'
  | 'clase-no-admite'
  | 'inscripcion-sin-lugar'
  | 'clase-completa'
  | 'duplicada'
  | 'motivo-obligatorio'
  | 'lotes-saturados'
  | 'red'
  | 'otro';

export interface ErrorAsistencia {
  readonly mensaje: string;
  readonly causa: CausaAsistencia;
}

const MENSAJE_GENERICO = 'No se pudo completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa la conexion y volve a intentar.';
const MENSAJE_SIN_CONTEXTO =
  'La asistencia es de una sede. Eligi una organizacion y un consultorio, y volve a entrar.';
const MENSAJE_SIN_PERMISO =
  'No tenes permiso para esta operacion en esta sede. Tomar lista pide asistencia:manage, ver ' +
  'los participantes inscripcion:read e iniciar o cerrar la clase clase:manage.';
const MENSAJE_NO_ENCONTRADO = 'La clase o el participante no existen en esta sede.';
const MENSAJE_CLASE_NO_ADMITE = 'La clase no admite esta operacion en su estado actual.';
const MENSAJE_SIN_LUGAR =
  'Esa inscripcion no tiene lugar en la clase (esta cancelada o en lista de espera).';
const MENSAJE_MOTIVO =
  'Cambiar una asistencia ya registrada es una correccion y necesita un motivo.';

export function errorSinContexto(): ErrorAsistencia {
  return { mensaje: MENSAJE_SIN_CONTEXTO, causa: 'sin-contexto' };
}

/** Traduce el `problemType` (slug) y el detalle del servidor. Comun al error HTTP y al item. */
function porTipo(
  tipo: AkineProblemType | string | null,
  detalle: string | undefined,
): ErrorAsistencia | null {
  const conDetalle = (base: string) => (detalle ? detalle : base);
  switch (tipo) {
    case 'clase-transicion-no-permitida':
      return { mensaje: conDetalle(MENSAJE_CLASE_NO_ADMITE), causa: 'clase-no-admite' };
    case 'inscripcion-transicion-no-permitida':
      return { mensaje: conDetalle(MENSAJE_SIN_LUGAR), causa: 'inscripcion-sin-lugar' };
    case 'clase-completa':
      return { mensaje: conDetalle('La clase no tiene lugares libres.'), causa: 'clase-completa' };
    case 'conflict':
      return {
        mensaje: conDetalle('La persona ya esta anotada en esta clase.'),
        causa: 'duplicada',
      };
    case 'validation-error':
      return { mensaje: conDetalle(MENSAJE_MOTIVO), causa: 'motivo-obligatorio' };
    case 'not-found':
      return { mensaje: conDetalle(MENSAJE_NO_ENCONTRADO), causa: 'no-encontrado' };
    default:
      return null;
  }
}

export function traducirErrorAsistencia(error: unknown): ErrorAsistencia {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: MENSAJE_GENERICO, causa: 'otro' };
  }
  if (error.esDeRed) {
    return { mensaje: MENSAJE_DE_RED, causa: 'red' };
  }
  if (error.faltaContexto) {
    return errorSinContexto();
  }
  const conocido = porTipo(error.problemType, error.problem?.detail);
  if (conocido !== null) {
    return conocido;
  }
  if (error.status === 403) {
    return { mensaje: MENSAJE_SIN_PERMISO, causa: 'sin-permiso' };
  }
  if (error.status === 404) {
    return { mensaje: MENSAJE_NO_ENCONTRADO, causa: 'no-encontrado' };
  }
  return { mensaje: error.problem?.detail || MENSAJE_GENERICO, causa: 'otro' };
}

/**
 * Traduce el fallo de UN participante del lote. `problemType` llega como URI completa
 * (`https://akine.app/problems/...`); se compara por su ultimo segmento.
 */
export function traducirFalloDeItem(
  problemType: string | undefined,
  detalle: string | undefined,
): ErrorAsistencia {
  const slug = (problemType ?? '').split('/').filter(Boolean).pop() ?? '';
  return porTipo(slug, detalle) ?? { mensaje: detalle || MENSAJE_GENERICO, causa: 'otro' };
}

/**
 * Error del guardado en lote. Aparte de {@link traducirErrorAsistencia} porque un `503` aca
 * tiene una causa concreta (appKine-api #157): la sede ya tiene demasiados lotes en curso. El
 * backend lo rechaza <b>antes de tocar nada</b>, asi que se dice que no se guardo y que lo
 * marcado sigue en pantalla. Fuera del lote, un 503 sigue siendo el aviso generico.
 */
export function traducirErrorDeLote(error: unknown): ErrorAsistencia {
  if (error instanceof AkineHttpError && error.esServicioNoDisponible && !error.esDeRed) {
    const segundos = error.reintentarEnSegundos;
    const n = segundos === null ? 0 : Math.ceil(segundos);
    const espera = n > 0 ? `en ${n} ${n === 1 ? 'segundo' : 'segundos'}` : 'en unos segundos';
    return {
      mensaje:
        `Hay muchos registros de asistencia en curso en esta sede. Probá de nuevo ${espera}. ` +
        'No se guardó nada: lo que marcaste sigue acá.',
      causa: 'lotes-saturados',
    };
  }
  return traducirErrorAsistencia(error);
}
