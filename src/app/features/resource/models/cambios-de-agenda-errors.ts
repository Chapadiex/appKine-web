import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import {
  MensajeTraducido,
  conDetalle,
  mensajeTraducido,
  segundosDeEspera,
} from './errores-comunes';

/** Por que no se pudo leer el historial de cambios de una agenda. */
export type CausaCambiosDeAgenda =
  /** 403 missing-tenant-context: hay sesion, pero no hay contexto elegido. NUNCA cerrar sesion. */
  | 'sin-contexto'
  /** 403 forbidden con `alcance: PROPIO`: el permiso alcanza solo la agenda propia. */
  | 'solo-propio'
  /** 403 forbidden: falta `agenda:excepciones`. */
  | 'sin-permiso'
  /** 404: el profesional no existe o es de otra organizacion. */
  | 'no-encontrado'
  /** 400: parametros invalidos (ventana invertida, tamaño fuera de rango). */
  | 'validacion'
  | 'limite'
  | 'red'
  | 'otro';

const MENSAJE_GENERICO =
  'No pudimos leer los cambios de la agenda. Volvé a intentar en un momento.';

/**
 * Traduce los errores de `listarHistorialDeAgenda` (contrato 0.155.0).
 *
 * <p>El 403 de alcance propio es el `forbidden` estandar con la extension `alcance: "PROPIO"`: se
 * distingue del 403 sin permiso porque las dos salidas son opuestas. Al profesional que pidio la
 * agenda de otro se le dice que solo ve la suya; a quien no tiene el permiso, que lo pida.
 */
export function traducirErrorCambiosDeAgenda(
  error: unknown,
): MensajeTraducido<CausaCambiosDeAgenda> {
  if (!(error instanceof AkineHttpError)) {
    return mensajeTraducido(MENSAJE_GENERICO, 'otro');
  }
  if (error.esDeRed) {
    return mensajeTraducido(
      'No se pudo contactar al servidor. Revisa tu conexión y volvé a intentar.',
      'red',
    );
  }
  if (error.esRateLimited) {
    const segundos = segundosDeEspera(error);
    return {
      ...mensajeTraducido(
        segundos > 0
          ? `Demasiadas consultas. Espera ${segundos} segundos y volvé a intentar.`
          : 'Demasiadas consultas. Espera un momento antes de volver a intentar.',
        'limite',
      ),
      segundosDeEspera: segundos,
    };
  }
  if (error.problemType === 'missing-tenant-context') {
    return mensajeTraducido(
      'Todavía no elegiste un contexto de trabajo. Elegí una sede para ver los cambios de la agenda.',
      'sin-contexto',
    );
  }
  if (error.status === 403 && error.extension('alcance') === 'PROPIO') {
    return mensajeTraducido('Solo podés ver los cambios de tu propia agenda.', 'solo-propio');
  }
  if (error.status === 403) {
    return mensajeTraducido(
      'No tenés permiso para ver los cambios de la agenda. Se necesita agenda:excepciones; ' +
        'pedíselo a quien administra la sede.',
      'sin-permiso',
    );
  }
  if (error.status === 404) {
    return mensajeTraducido(
      'Ese profesional ya no existe o no pertenece a esta organización. Volvé a elegirlo en la lista.',
      'no-encontrado',
    );
  }
  if (error.status === 400) {
    return mensajeTraducido(conDetalle(error, MENSAJE_GENERICO), 'validacion');
  }
  return mensajeTraducido(conDetalle(error, MENSAJE_GENERICO), 'otro');
}
