import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Errores de productos de pack y pases (M29, AKINE-08.06).
 *
 * <p>Se ramifica por `problemType`, nunca por el texto. El backend publico dos tipos propios y reusa
 * los genericos:
 *
 * <ul>
 *   <li><b>`producto-no-vendible`</b>: el producto esta fuera de su ventana comercial hoy, en la
 *       zona de la sede. Viaja con `motivo`.</li>
 *   <li><b>`producto-nombre-en-uso`</b>: ya hay un producto vigente con ese nombre en la sede.</li>
 *   <li><b>`conflict`</b>: la oferta no admite pack (no es `POR_PACK` o no esta activa), el producto
 *       esta dado de baja o la ficha de la persona esta dada de baja. El `detail` del servidor nombra
 *       cual, y es lo que se muestra.</li>
 *   <li><b>`concurrent-modification`</b>: la version del producto quedo vieja.</li>
 *   <li><b>`idempotency-key-conflict`</b>: un bug del cliente; se resuelve con una clave nueva.</li>
 * </ul>
 */
export type CausaPase =
  | 'validacion'
  | 'sin-contexto'
  | 'sin-permiso'
  | 'no-encontrado'
  | 'producto-no-vendible'
  | 'nombre-en-uso'
  | 'version-vieja'
  | 'clave-reusada'
  | 'conflicto'
  | 'red'
  | 'otro';

export interface ErrorPase {
  readonly mensaje: string;
  readonly causa: CausaPase;
  /** Campo -> mensaje, solo en `validacion`. */
  readonly campos: Readonly<Record<string, string>>;
}

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
const MENSAJE_SIN_CONTEXTO =
  'Los productos y los pases son de una sede. Eligi una organizacion y un consultorio, y volve a ' +
  'entrar. Tu sesion sigue abierta.';
const MENSAJE_SIN_PERMISO =
  'No tenes permiso para esto en esta sede: el catalogo pide producto:read (y producto:manage para ' +
  'cambiarlo), y los pases pase:read (y pase:manage para venderlos). Pediselo a quien administra ' +
  'el centro.';
const MENSAJE_NO_ENCONTRADO = 'El producto, el pase o la persona no existe, o no es de esta sede.';
const MENSAJE_NO_VENDIBLE =
  'Ese producto no se puede vender hoy: esta fuera de su ventana comercial. Revisa sus fechas en ' +
  'el catalogo.';
const MENSAJE_NOMBRE = 'Ya hay un producto vigente con ese nombre en esta sede. Elegi otro nombre.';
const MENSAJE_VERSION_VIEJA =
  'Alguien modifico el producto mientras lo editabas. No se cambio nada: volve a leerlo y repeti ' +
  'el cambio.';
const MENSAJE_CLAVE_REUSADA =
  'Hubo un problema tecnico con este intento. No se vendio nada y no es un error tuyo: volve a ' +
  'intentarlo.';
const MENSAJE_VALIDACION = 'Revisa los datos marcados.';

function armar(causa: CausaPase, mensaje: string): ErrorPase {
  return { mensaje, causa, campos: {} };
}

export function errorSinContextoDePase(): ErrorPase {
  return armar('sin-contexto', MENSAJE_SIN_CONTEXTO);
}

export function traducirErrorPase(error: unknown): ErrorPase {
  if (!(error instanceof AkineHttpError)) {
    return armar('otro', MENSAJE_GENERICO);
  }
  if (error.esDeRed) {
    return armar('red', MENSAJE_DE_RED);
  }
  if (error.faltaContexto) {
    return errorSinContextoDePase();
  }
  const detalle = error.problem?.detail ?? '';
  switch (error.problemType) {
    case 'validation-error':
    case 'parametro-invalido':
      return {
        ...armar('validacion', detalle || MENSAJE_VALIDACION),
        campos: error.erroresPorCampo,
      };
    case 'producto-no-vendible':
      return armar('producto-no-vendible', detalle || MENSAJE_NO_VENDIBLE);
    case 'producto-nombre-en-uso':
      return armar('nombre-en-uso', MENSAJE_NOMBRE);
    case 'concurrent-modification':
      return armar('version-vieja', MENSAJE_VERSION_VIEJA);
    case 'idempotency-key-conflict':
      return armar('clave-reusada', MENSAJE_CLAVE_REUSADA);
    case 'conflict':
      return armar('conflicto', detalle || MENSAJE_GENERICO);
    default:
      break;
  }
  if (error.status === 403) {
    return armar('sin-permiso', MENSAJE_SIN_PERMISO);
  }
  if (error.status === 404) {
    return armar('no-encontrado', MENSAJE_NO_ENCONTRADO);
  }
  return armar('otro', detalle || MENSAJE_GENERICO);
}
