import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Traduccion de los errores de la atencion clinica grupal (M14/M28, AKINE-08.05).
 *
 * <p>Se ramifica por `problemType`, nunca por el texto de `detail`. Los cuatro tipos propios de la
 * etapa tienen cada uno su salida, y por eso cada uno tiene su texto:
 *
 * <ul>
 *   <li><b>`participacion-sin-derivacion`</b>: el participante estuvo, pero nadie lo derivo a un
 *       Caso. Abrir la atencion no es derivar: la derivacion elige el Caso y es una decision
 *       clinica previa.</li>
 *   <li><b>`derivacion-ambigua`</b>: tiene varias derivaciones vigentes —dos Casos— y no se dijo
 *       de cual es esta atencion. <b>La pantalla nunca elige</b>: numerar la Sesion en el Caso
 *       equivocado no se corrige sin reescribir historia clinica. Trae `derivacionIds`.</li>
 *   <li><b>`derivacion-con-sesion`</b>: se quiso revertir una derivacion de la que ya cuelga una
 *       atencion. La Sesion no se borra, y la derivacion que explica de donde vino tampoco.</li>
 *   <li><b>`caso-de-atencion-grupal`</b>: se quiso cambiar el Caso de una atencion grupal. Lo fijo
 *       la derivacion.</li>
 * </ul>
 *
 * <p>El lote devuelve el mismo `problemType` por participante —como URI completa— y
 * {@link traducirFalloDeAtencion} lo traduce con el mismo criterio.
 */
export type CausaAtencionGrupal =
  | 'sin-contexto'
  | 'sin-permiso'
  /** 403 `justificacion-de-acceso-requerida`: sin relacion asistencial hay que declarar motivo. */
  | 'requiere-justificacion'
  | 'no-encontrado'
  /** 409 `oferta-no-clinica`: la clase no genera registro clinico (RN-M14-008). */
  | 'oferta-no-clinica'
  /** 409 `participacion-sin-asistencia`: no figura presente. */
  | 'sin-asistencia'
  | 'sin-derivacion'
  | 'derivacion-ambigua'
  | 'derivacion-con-sesion'
  | 'caso-de-atencion-grupal'
  /** 409 `caso-clinico-cerrado`: el Caso de la derivacion se cerro. */
  | 'caso-cerrado'
  /** 409 `persona-sin-perfil-paciente`. */
  | 'sin-perfil-paciente'
  /** 409 `caso-no-activo`: al derivar, el Caso elegido no esta activo o no es de esa historia. */
  | 'caso-no-activo'
  /** 409 `autorizacion-no-elegible`: al derivar, la autorizacion declarada no habilita. */
  | 'autorizacion-no-elegible'
  /** 400 `validation-error`: la reversion sin motivo. */
  | 'motivo-obligatorio'
  | 'red'
  | 'otro';

export interface ErrorAtencionGrupal {
  readonly mensaje: string;
  readonly causa: CausaAtencionGrupal;
  /** Las derivaciones vigentes entre las que hay que elegir. Solo en `derivacion-ambigua`. */
  readonly derivacionIds?: readonly number[];
}

const MENSAJE_GENERICO = 'No se pudo completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa la conexion y volve a intentar.';

const MENSAJE_SIN_CONTEXTO =
  'La atencion clinica de una clase es de una sede. Eligi una organizacion y un consultorio, y ' +
  'volve a entrar.';

const MENSAJE_SIN_PERMISO =
  'No tenes permiso para esta operacion en esta sede. Atender a los participantes de una clase ' +
  'pide sesion:register e inscripcion:read; ver o revertir una derivacion pide ademas acceso a la ' +
  'historia clinica.';

const MENSAJE_REQUIERE_JUSTIFICACION =
  'No figura que atiendas a esta persona. Para abrir su atencion o ver sus derivaciones tenes que ' +
  'declarar el motivo del acceso: queda registrado junto con cada operacion.';

const MENSAJE_NO_ENCONTRADO = 'La clase, el participante o la derivacion no existen en esta sede.';

const MENSAJE_OFERTA_NO_CLINICA =
  'Esta clase no genera registro clinico: su oferta no lo pide, asi que sus participantes no tienen ' +
  'atencion clinica que abrir.';

const MENSAJE_SIN_ASISTENCIA =
  'No figura presente en la clase. Solo se atiende a quien estuvo: si fue un error de la lista, ' +
  'corregi la asistencia (con motivo) y volve a intentar.';

const MENSAJE_SIN_DERIVACION =
  'No tiene una derivacion clinica vigente en esta clase. La atencion cuelga de una derivacion, ' +
  'que es la que dice a que caso clinico pertenece: primero hay que derivarlo a un caso.';

const MENSAJE_DERIVACION_AMBIGUA =
  'Tiene mas de una derivacion vigente en esta clase —a casos distintos— y no se dijo de cual es ' +
  'esta atencion. Elegi la derivacion: la atencion se numera dentro de su caso, y eso no se ' +
  'corrige despues.';

const MENSAJE_DERIVACION_CON_SESION =
  'Esta derivacion no se puede revertir: ya se abrio una atencion clinica desde ella. La atencion ' +
  'no se borra, y la derivacion es la que explica de donde vino el paciente. Si la atencion se ' +
  'abrio por error, cerrala con lo que paso (ausente, si no hubo atencion) o enmenda su nota.';

const MENSAJE_CASO_DE_ATENCION_GRUPAL =
  'El caso de una atencion de clase no se cambia: lo fijo la derivacion. Si correspondia otro ' +
  'caso, cerra la atencion con lo que paso y deriva al participante al caso correcto.';

const MENSAJE_CASO_CERRADO =
  'El caso clinico de la derivacion ya no esta activo, asi que no admite atenciones nuevas. Se ' +
  'reabre desde la historia clinica, o se deriva al participante a otro caso.';

const MENSAJE_SIN_PERFIL =
  'La persona todavia no es paciente: hace falta activar su perfil de paciente.';

const MENSAJE_CASO_NO_ACTIVO =
  'El caso elegido ya no esta activo. Volve a cargar los casos y elegi uno activo, o reabrilo ' +
  'desde la historia clinica.';

const MENSAJE_AUTORIZACION_NO_ELEGIBLE =
  'La autorizacion declarada no habilita el dia de la clase (vencida, agotada, aun no vigente o ' +
  'no aprobada).';

const MENSAJE_MOTIVO = 'Revertir una derivacion necesita un motivo.';

const POR_TIPO: Readonly<Record<string, readonly [CausaAtencionGrupal, string]>> = {
  'missing-tenant-context': ['sin-contexto', MENSAJE_SIN_CONTEXTO],
  'justificacion-de-acceso-requerida': ['requiere-justificacion', MENSAJE_REQUIERE_JUSTIFICACION],
  'oferta-no-clinica': ['oferta-no-clinica', MENSAJE_OFERTA_NO_CLINICA],
  'participacion-sin-asistencia': ['sin-asistencia', MENSAJE_SIN_ASISTENCIA],
  'participacion-sin-derivacion': ['sin-derivacion', MENSAJE_SIN_DERIVACION],
  'derivacion-ambigua': ['derivacion-ambigua', MENSAJE_DERIVACION_AMBIGUA],
  'derivacion-con-sesion': ['derivacion-con-sesion', MENSAJE_DERIVACION_CON_SESION],
  'caso-de-atencion-grupal': ['caso-de-atencion-grupal', MENSAJE_CASO_DE_ATENCION_GRUPAL],
  'caso-clinico-cerrado': ['caso-cerrado', MENSAJE_CASO_CERRADO],
  'persona-sin-perfil-paciente': ['sin-perfil-paciente', MENSAJE_SIN_PERFIL],
  'caso-no-activo': ['caso-no-activo', MENSAJE_CASO_NO_ACTIVO],
  'autorizacion-no-elegible': ['autorizacion-no-elegible', MENSAJE_AUTORIZACION_NO_ELEGIBLE],
  'derivacion-no-accesible': ['no-encontrado', MENSAJE_NO_ENCONTRADO],
  'validation-error': ['motivo-obligatorio', MENSAJE_MOTIVO],
};

function porTipo(slug: string | null): ErrorAtencionGrupal | null {
  const conocido = slug === null ? undefined : POR_TIPO[slug];
  return conocido === undefined ? null : { causa: conocido[0], mensaje: conocido[1] };
}

/** La pantalla se abrio sin sede elegida. */
export function errorSinContextoGrupal(): ErrorAtencionGrupal {
  return { mensaje: MENSAJE_SIN_CONTEXTO, causa: 'sin-contexto' };
}

/** Traduce el error de una operacion del panel (individual, lote, derivaciones o reversion). */
export function traducirErrorAtencionGrupal(error: unknown): ErrorAtencionGrupal {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: MENSAJE_GENERICO, causa: 'otro' };
  }
  if (error.esDeRed) {
    return { mensaje: MENSAJE_DE_RED, causa: 'red' };
  }
  if (error.faltaContexto) {
    return errorSinContextoGrupal();
  }
  const conocido = porTipo(error.problemType);
  if (conocido !== null) {
    return conocido.causa === 'derivacion-ambigua'
      ? { ...conocido, derivacionIds: idsDeExtension(error.extension('derivacionIds')) }
      : conocido;
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
 * (`https://akine.app/problems/...`); se compara por su ultimo segmento. Un tipo no previsto se
 * muestra con el `detalle` del servidor, que el backend ya limpio de internals.
 */
export function traducirFalloDeAtencion(
  problemType: string | undefined,
  detalle: string | undefined,
): ErrorAtencionGrupal {
  const slug = (problemType ?? '').split('/').filter(Boolean).pop() ?? '';
  return porTipo(slug) ?? { mensaje: detalle || MENSAJE_GENERICO, causa: 'otro' };
}

/** Los ids de `derivacionIds`, descartando lo que no sea un entero. */
function idsDeExtension(valor: unknown): number[] {
  return Array.isArray(valor) ? valor.filter((id): id is number => Number.isInteger(id)) : [];
}
