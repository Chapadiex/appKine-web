import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { importeDePase } from './etiquetas-de-pases';

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
 *   <li><b>`abono-periodo-superpuesto`</b> (08.08): la persona ya tiene ese abono en un periodo que se
 *       pisa con el elegido.</li>
 *   <li><b>`pase-no-ajustable`</b> (08.07): anulado, vencido, saldo final fuera de `[0, comprados]` o,
 *       al anular, creditos ya usados. Desde 0.111.0 viaja con `causa` (`ESTADO`,
 *       `FUERA_DE_VIGENCIA`, `FUERA_DE_RANGO`, `CREDITOS_USADOS`): el mensaje se arma por esa
 *       causa, nunca leyendo el texto de `motivo`, que queda solo como respaldo si `causa` falta.</li>
 *   <li><b>`pase-con-cobros`</b> (08.07): la deuda de la venta tiene cobros, asi que no se anula —ni
 *       ella ni el pase—. Viaja con `obligacionId`, `cobrado` y, desde 0.111.0, `moneda`
 *       (ISO 4217), para decir el importe con su moneda.</li>
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
  | 'abono-superpuesto'
  | 'pase-no-ajustable'
  | 'pase-con-cobros'
  | 'conflicto'
  | 'red'
  | 'otro';

export interface ErrorPase {
  readonly mensaje: string;
  readonly causa: CausaPase;
  /** Campo -> mensaje, solo en `validacion`. */
  readonly campos: Readonly<Record<string, string>>;
  /** Lo ya cobrado de la deuda, solo en `pase-con-cobros`. */
  readonly cobrado?: number;
}

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
const MENSAJE_SIN_CONTEXTO =
  'Los productos y los pases son de una sede. Eligi una organizacion y un consultorio, y volve a ' +
  'entrar. Tu sesion sigue abierta.';
const MENSAJE_SIN_PERMISO =
  'No tenes permiso para esto en esta sede: el catalogo pide producto:read (y producto:manage para ' +
  'cambiarlo), y los pases pase:read (pase:manage para venderlos y pase:adjust para ajustar el ' +
  'saldo o anularlos). Pediselo a quien administra el centro.';
const MENSAJE_NO_ENCONTRADO = 'El producto, el pase o la persona no existe, o no es de esta sede.';
const MENSAJE_NO_VENDIBLE =
  'Ese producto no se puede vender hoy: esta fuera de su ventana comercial. Revisa sus fechas en ' +
  'el catalogo.';
const MENSAJE_NOMBRE = 'Ya hay un producto vigente con ese nombre en esta sede. Elegi otro nombre.';
const MENSAJE_VERSION_VIEJA =
  'Alguien lo modifico mientras lo editabas. No se cambio nada: volve a leerlo y repeti el cambio.';
const MENSAJE_CLAVE_REUSADA =
  'Hubo un problema tecnico con este intento. No se vendio nada y no es un error tuyo: volve a ' +
  'intentarlo.';
const MENSAJE_VALIDACION = 'Revisa los datos marcados.';
const MENSAJE_ABONO_SUPERPUESTO =
  'Esta persona ya tiene ese abono en un periodo que se superpone con el elegido. No se vendio ' +
  'nada: elegi un periodo que empiece despues de que termine el que ya tiene.';
const MENSAJE_NO_AJUSTABLE =
  'El pase no admite esa operacion. No se cambio nada: volve a leerlo para ver su estado y su saldo.';
/** La extension `causa` de `pase-no-ajustable` (0.111.0), un valor estable para el cliente. */
const MENSAJES_NO_AJUSTABLE: Readonly<Record<string, string>> = {
  ESTADO:
    'No se puede: el pase esta anulado o vencido, y en ese estado su saldo ya no se toca. No se ' +
    'cambio nada.',
  FUERA_DE_VIGENCIA:
    'No se puede: la vigencia del pase ya termino, aunque todavia figure activo. No se cambio nada.',
  FUERA_DE_RANGO:
    'No se puede: el saldo quedaria por debajo de 0 o por encima de los creditos comprados. No se ' +
    'cambio nada: revisa la cantidad.',
  CREDITOS_USADOS:
    'No se puede anular: el pase ya tiene creditos usados en asistencias. No se cambio nada.',
};

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
    case 'abono-periodo-superpuesto':
      return armar('abono-superpuesto', MENSAJE_ABONO_SUPERPUESTO);
    case 'pase-no-ajustable':
      return armar(
        'pase-no-ajustable',
        mensajeNoAjustable(error.extension('causa'), error.extension('motivo')),
      );
    case 'pase-con-cobros':
      return conCobros(error.numeroDeExtension('cobrado'), error.extension('moneda'));
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

/**
 * Por `causa`. Sin ella (un backend anterior a 0.111.0, o una causa nueva que este cliente no
 * conoce) el `motivo` completa "el pase ...", tal como llega, sin interpretarlo.
 */
function mensajeNoAjustable(causa: unknown, motivo: unknown): string {
  if (typeof causa === 'string' && Object.hasOwn(MENSAJES_NO_AJUSTABLE, causa)) {
    return MENSAJES_NO_AJUSTABLE[causa];
  }
  if (typeof motivo !== 'string' || motivo.trim() === '') {
    return MENSAJE_NO_AJUSTABLE;
  }
  return `No se puede: el pase ${motivo.trim()}. No se cambio nada.`;
}

/**
 * Una deuda con cobros no se anula (RF-M19-010): lo que corresponde es anular o reintegrar el cobro
 * desde la cuenta corriente. Hasta entonces el pase sigue como estaba.
 */
function conCobros(cobrado: number | null, moneda: unknown): ErrorPase {
  const cuanto =
    cobrado === null
      ? ''
      : ` (${importeDePase(cobrado, typeof moneda === 'string' ? moneda : undefined)} cobrados)`;
  return {
    ...armar(
      'pase-con-cobros',
      `No se puede anular: la deuda de esta venta ya tiene cobros${cuanto}. Primero hay que anular ` +
        'o reintegrar el cobro desde la cuenta corriente; el pase y su deuda siguen como estaban.',
    ),
    ...(cobrado === null ? {} : { cobrado }),
  };
}
