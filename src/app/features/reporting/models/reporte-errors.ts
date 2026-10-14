import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Traduccion de los errores de M23 (reportes, AKINE-07.06).
 *
 * <p>Sigue el patron de las demas features: el `problemType` decide la causa y el mensaje es el
 * del backend cuando lo hay (AGENT.md §8). El rango invalido agrega el `maximoDias` que el
 * servidor publica, para que nadie tenga que adivinar cuanto puede pedir.
 */
export type CausaReporte =
  'sin-contexto' | 'sin-permiso' | 'no-encontrado' | 'rango-invalido' | 'red' | 'otro';

export interface ErrorReporte {
  readonly mensaje: string;
  readonly causa: CausaReporte;
}

const MENSAJE_GENERICO = 'No se pudo generar el reporte. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa la conexion y volve a intentar.';
const MENSAJE_SIN_CONTEXTO =
  'Los reportes son de una sede. Eligi una organizacion y un consultorio, y volve a entrar.';
const MENSAJE_SIN_PERMISO =
  'No tenes permiso para ver reportes en esta sede (reporte:read). Pediselo a quien administra ' +
  'el centro.';
const MENSAJE_NO_ENCONTRADO = 'La sede no existe o no es de esta organizacion.';
const MENSAJE_RANGO = 'El periodo pedido no sirve para reportar.';

export function errorSinContexto(): ErrorReporte {
  return { mensaje: MENSAJE_SIN_CONTEXTO, causa: 'sin-contexto' };
}

export function traducirErrorReporte(error: unknown): ErrorReporte {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: MENSAJE_GENERICO, causa: 'otro' };
  }
  if (error.esDeRed) {
    return { mensaje: MENSAJE_DE_RED, causa: 'red' };
  }
  if (error.faltaContexto) {
    return errorSinContexto();
  }
  if (error.problemType === 'rango-de-reporte-invalido') {
    const maximo = error.numeroDeExtension('maximoDias');
    const base = error.problem?.detail || MENSAJE_RANGO;
    const conMaximo =
      maximo !== null && !base.includes(String(maximo))
        ? `${base}. Un reporte abarca como maximo ${maximo} dias.`
        : base;
    return { mensaje: conMaximo, causa: 'rango-invalido' };
  }
  if (error.status === 403) {
    return { mensaje: MENSAJE_SIN_PERMISO, causa: 'sin-permiso' };
  }
  if (error.status === 404) {
    return { mensaje: MENSAJE_NO_ENCONTRADO, causa: 'no-encontrado' };
  }
  return { mensaje: error.problem?.detail || MENSAJE_GENERICO, causa: 'otro' };
}
