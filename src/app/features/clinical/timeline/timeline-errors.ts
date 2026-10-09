import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

export type CausaTimeline = 'sin-contexto' | 'sin-permiso' | 'no-encontrado' | 'red' | 'otro';

export interface ErrorTimeline {
  readonly mensaje: string;
  readonly causa: CausaTimeline;
}

/** Traduce un error del backend; se ramifica por `problemType` y `status`, nunca por `detail`. */
export function traducirErrorTimeline(error: unknown): ErrorTimeline {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: 'No se pudo completar la operacion. Proba de nuevo.', causa: 'otro' };
  }
  if (error.esDeRed) {
    return { mensaje: 'No hay conexion con el servidor. Revisa tu red.', causa: 'red' };
  }
  if (error.problemType === 'missing-tenant-context') {
    return { mensaje: 'Elegi una sede para ver la historia clinica.', causa: 'sin-contexto' };
  }
  if (error.status === 403) {
    return { mensaje: 'No tenes permiso para ver esta historia clinica.', causa: 'sin-permiso' };
  }
  if (error.status === 404) {
    return { mensaje: 'No encontramos la historia clinica.', causa: 'no-encontrado' };
  }
  return { mensaje: 'No se pudo completar la operacion. Proba de nuevo.', causa: 'otro' };
}
