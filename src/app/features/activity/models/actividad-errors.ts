import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Errores de las clases grupales y sus inscripciones (M28, AKINE-08.01 y 08.02).
 *
 * <p>Se ramifica por `problemType`, nunca por el texto de `detail`. El backend publico cinco tipos
 * propios para el modulo `activity` y reusa otros cinco del resto del producto; cada uno lleva a
 * una accion distinta, y meterlos en una bolsa comun le devuelve al mostrador un "no se pudo" sin
 * salida:
 *
 * <ul>
 *   <li><b>`clase-no-programable`</b>: la oferta no es grupal, esta de baja o fuera de vigencia.
 *       Se corrige eligiendo otra oferta. Viaja con `motivo`.</li>
 *   <li><b>`clase-capacidad-no-admitida`</b>: el cupo pedido no entra en la oferta o en el box, o
 *       quedaria por debajo de los ya inscriptos. Viaja con `capacidadPedida` y
 *       `capacidadMaxima`.</li>
 *   <li><b>`clase-transicion-no-permitida`</b>: la clase ya empezo, termino o esta cancelada.
 *       Se resuelve releyendo la clase. Viaja con `motivo`.</li>
 *   <li><b>`clase-completa`</b>: no queda lugar y no se acepto la lista de espera. La accion es
 *       <b>ofrecer la espera</b>, sin otra vuelta. Viaja con `capacidadEfectiva` y `ocupados`.</li>
 *   <li><b>`inscripcion-transicion-no-permitida`</b>: la inscripcion esta en espera, cancelada o
 *       con asistencia. Se resuelve releyendo los participantes. Viaja con `motivo`.</li>
 * </ul>
 *
 * <p>Los reusados: <b>`recurso-ocupado`</b> (profesional o box con un turno u otra clase que se
 * cruza, con `recurso`), <b>`slot-no-disponible`</b> (el profesional no atiende ese horario, con
 * `motivo`), <b>`conflict`</b> en la inscripcion —la persona ya esta anotada, con
 * `inscripcionExistenteId`—, <b>`concurrent-modification`</b> (la version de la clase quedo vieja)
 * e <b>`idempotency-key-conflict`</b>, que es un bug del cliente y se resuelve con una clave
 * nueva.
 */
export type CausaActividad =
  | 'validacion'
  | 'sin-contexto'
  | 'sin-permiso'
  | 'no-encontrado'
  | 'clase-no-programable'
  | 'clase-capacidad-no-admitida'
  | 'clase-transicion-no-permitida'
  | 'clase-completa'
  | 'inscripcion-transicion-no-permitida'
  | 'recurso-ocupado'
  | 'horario-no-disponible'
  | 'ya-inscripta'
  | 'version-vieja'
  | 'clave-reusada'
  | 'suscripcion-suspendida'
  | 'conflicto'
  | 'limite'
  | 'red'
  | 'otro';

/** Que puede hacer el usuario a continuacion. La pantalla ramifica por esto, no por la causa. */
export type AccionActividad =
  /** Volver a leer la clase (y sus cupos): lo que se ve quedo viejo. */
  | 'recargar'
  /** Inscribir de nuevo aceptando la lista de espera. */
  | 'ofrecer-espera'
  /** Corregir horario, profesional, oferta o cupo en el formulario. */
  | 'corregir'
  | 'reintentar-con-clave-nueva'
  | 'elegir-contexto'
  | 'ninguna';

export interface ErrorActividad {
  readonly mensaje: string;
  readonly causa: CausaActividad;
  readonly accion: AccionActividad;
  /** Lo que el servidor agrego en `motivo`, si algo. */
  readonly motivo: string;
  /** Campo -> mensaje, solo en `validacion`. */
  readonly campos: Readonly<Record<string, string>>;
}

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
const MENSAJE_SIN_CONTEXTO =
  'Las clases son de una sede. Eligi una organizacion y un consultorio, y volve a entrar. Tu ' +
  'sesion sigue abierta.';
const MENSAJE_SIN_PERMISO =
  'No tenes permiso para esto en esta sede: mirar la grilla pide clase:read, programar clase:manage ' +
  'y los participantes inscripcion:read o inscripcion:manage. Pediselo a quien administra el centro.';
const MENSAJE_NO_ENCONTRADO =
  'La clase, la oferta, la persona o la inscripcion ya no existe, o no es de esta sede.';
const MENSAJE_NO_PROGRAMABLE =
  'Esa oferta no puede sostener una clase: tiene que ser grupal, estar activa y vigente en la ' +
  'fecha elegida. Elegi otra oferta.';
const MENSAJE_TRANSICION_CLASE =
  'La clase no admite esa operacion en su estado actual: ya empezo, ya termino o esta cancelada. ' +
  'Volve a leerla.';
const MENSAJE_COMPLETA =
  'La clase no tiene lugares disponibles. Podes anotar a la persona en la lista de espera: entra ' +
  'sola en cuanto alguien se da de baja.';
const MENSAJE_TRANSICION_INSCRIPCION =
  'La inscripcion no admite esa operacion: esta en la lista de espera, ya fue cancelada o ya tiene ' +
  'asistencia registrada. Volve a leer los participantes.';
const MENSAJE_RECURSO_OCUPADO =
  'Ya hay un turno u otra clase que se cruza con ese horario. Elegi otro horario u otro profesional.';
const MENSAJE_HORARIO =
  'El profesional no atiende en ese horario, no esta habilitado para la oferta, o el box no esta ' +
  'disponible. Elegi otro horario, otro profesional u otro box.';
const MENSAJE_YA_INSCRIPTA = 'Esa persona ya esta anotada en esta clase.';
const MENSAJE_VERSION_VIEJA =
  'Alguien modifico la clase mientras la mirabas. No se cambio nada: volve a leerla y repeti la ' +
  'operacion.';
const MENSAJE_CLAVE_REUSADA =
  'Hubo un problema tecnico con este intento: la clave que lo identifica ya se habia usado para otro ' +
  'pedido. No se hizo nada y no es un error tuyo. Volve a intentarlo.';
const MENSAJE_SUSCRIPCION =
  'La suscripcion de la organizacion esta suspendida, asi que no se pueden programar clases ni ' +
  'inscribir personas.';
const MENSAJE_LIMITE = 'Demasiados intentos. Espera un momento antes de volver a intentar.';
const MENSAJE_VALIDACION = 'Revisa los datos marcados.';

export function errorSinContextoDeActividad(): ErrorActividad {
  return armar('sin-contexto', 'elegir-contexto', MENSAJE_SIN_CONTEXTO);
}

/** Traduce un error de cualquier operacion de clases o inscripciones. */
export function traducirErrorActividad(error: unknown): ErrorActividad {
  if (!(error instanceof AkineHttpError)) {
    return armar('otro', 'ninguna', MENSAJE_GENERICO);
  }
  if (error.esDeRed) {
    return armar('red', 'ninguna', MENSAJE_DE_RED);
  }
  if (error.faltaContexto) {
    return errorSinContextoDeActividad();
  }
  const motivo = textoDeExtension(error, 'motivo');
  const detalle = error.problem?.detail ?? '';

  switch (error.problemType) {
    case 'validation-error':
    case 'parametro-invalido':
      return {
        ...armar('validacion', 'corregir', detalle || MENSAJE_VALIDACION),
        campos: error.erroresPorCampo,
      };
    case 'clase-no-programable':
      return armar('clase-no-programable', 'corregir', MENSAJE_NO_PROGRAMABLE, motivo);
    case 'clase-capacidad-no-admitida':
      return armar('clase-capacidad-no-admitida', 'corregir', mensajeDeCapacidad(error), motivo);
    case 'clase-transicion-no-permitida':
      return armar('clase-transicion-no-permitida', 'recargar', MENSAJE_TRANSICION_CLASE, motivo);
    case 'clase-completa':
      return armar('clase-completa', 'ofrecer-espera', mensajeDeCompleta(error));
    case 'inscripcion-transicion-no-permitida':
      return armar(
        'inscripcion-transicion-no-permitida',
        'recargar',
        MENSAJE_TRANSICION_INSCRIPCION,
        motivo,
      );
    case 'recurso-ocupado':
      return armar('recurso-ocupado', 'corregir', mensajeDeRecurso(error));
    case 'slot-no-disponible':
      return armar('horario-no-disponible', 'corregir', MENSAJE_HORARIO, motivo);
    case 'concurrent-modification':
      return armar('version-vieja', 'recargar', MENSAJE_VERSION_VIEJA);
    case 'idempotency-key-conflict':
      return armar('clave-reusada', 'reintentar-con-clave-nueva', MENSAJE_CLAVE_REUSADA);
    case 'subscription-suspended':
      return armar('suscripcion-suspendida', 'ninguna', MENSAJE_SUSCRIPCION);
    case 'conflict':
      return error.extension('inscripcionExistenteId') !== undefined
        ? armar('ya-inscripta', 'recargar', MENSAJE_YA_INSCRIPTA)
        : armar('conflicto', 'recargar', detalle || MENSAJE_GENERICO);
    default:
      break;
  }
  if (error.esRateLimited) {
    return armar('limite', 'ninguna', MENSAJE_LIMITE);
  }
  if (error.status === 403) {
    return armar('sin-permiso', 'ninguna', MENSAJE_SIN_PERMISO);
  }
  if (error.status === 404) {
    return armar('no-encontrado', 'recargar', MENSAJE_NO_ENCONTRADO);
  }
  if (error.status === 409) {
    return armar('conflicto', 'recargar', detalle || MENSAJE_GENERICO);
  }
  return armar('otro', 'ninguna', detalle || MENSAJE_GENERICO);
}

function mensajeDeCapacidad(error: AkineHttpError): string {
  const maxima = error.numeroDeExtension('capacidadMaxima');
  const pedida = error.numeroDeExtension('capacidadPedida');
  const base = 'El cupo pedido no es admisible para esta clase.';
  if (maxima === null) {
    return `${base} Revisa la capacidad de la oferta y del box.`;
  }
  return (
    `${base} Pediste ${pedida ?? '?'} lugares y el limite es ${maxima}: lo fija la oferta, el box ` +
    'o la cantidad de personas ya inscriptas.'
  );
}

function mensajeDeCompleta(error: AkineHttpError): string {
  const efectiva = error.numeroDeExtension('capacidadEfectiva');
  const ocupados = error.numeroDeExtension('ocupados');
  if (efectiva === null) {
    return MENSAJE_COMPLETA;
  }
  return `${MENSAJE_COMPLETA} Ocupados ${ocupados ?? efectiva} de ${efectiva}.`;
}

function mensajeDeRecurso(error: AkineHttpError): string {
  const recurso = textoDeExtension(error, 'recurso');
  if (recurso === 'profesional') {
    return 'El profesional ya tiene un turno u otra clase que se cruza con ese horario. Elegi otro horario u otro profesional.';
  }
  if (recurso === 'espacio') {
    return 'El box ya tiene un turno u otra clase que se cruza con ese horario. Elegi otro horario.';
  }
  return MENSAJE_RECURSO_OCUPADO;
}

function armar(
  causa: CausaActividad,
  accion: AccionActividad,
  mensaje: string,
  motivo = '',
): ErrorActividad {
  return { mensaje, causa, accion, motivo, campos: {} };
}

function textoDeExtension(error: AkineHttpError, clave: string): string {
  const valor = error.extension(clave);
  return typeof valor === 'string' ? valor : '';
}
