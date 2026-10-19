import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { importeEnPalabras } from './etiquetas-de-obligacion';

/**
 * Traduccion de los rechazos de M22 (egresos y pagos, AKINE-07.05) a lo que la pantalla hace.
 *
 * <p>Mismo criterio que `caja-errors.ts` y `presentacion-errors.ts`: decide el `problemType`,
 * nunca el texto. Para los tipos propios de M22 el mensaje es nuestro —dice que paso y que hacer—
 * y, cuando el backend manda el dato que lo vuelve accionable (`saldoDisponible`, `yaPagado`), lo
 * incluye. Lo que no se reconoce cae al `detail` del backend (AGENT.md 8).
 *
 * <p>`recargar` dice que lo que hay en pantalla quedo viejo —otro puesto confirmo, pago o anulo
 * antes— y conviene releer el egreso antes de reintentar. `irACaja` dice que la salida esta en la
 * caja de la sede, no en este formulario.
 */
export type CausaEgreso =
  | 'sin-contexto'
  | 'sin-permiso'
  | 'no-encontrado'
  | 'no-editable'
  | 'no-confirmable'
  | 'sin-comprobante'
  | 'ya-anulado'
  | 'con-pagos'
  | 'no-pagable'
  | 'saldo-insuficiente'
  | 'comprobante-duplicado'
  | 'pago-ya-anulado'
  | 'beneficiario-no-vinculado'
  | 'caja'
  | 'clave-reusada'
  | 'de-liquidacion'
  | 'borrador-desactualizado'
  | 'liquidacion-vacia'
  | 'datos-invalidos'
  | 'conflicto'
  | 'version-vieja'
  | 'red'
  | 'otro';

export interface ErrorEgreso {
  readonly mensaje: string;
  readonly causa: CausaEgreso;
  readonly recargar: boolean;
  readonly irACaja?: boolean;
  /** `true` cuando la clave de idempotencia del intento ya no sirve y hay que generar otra. */
  readonly renovarClave?: boolean;
}

const MENSAJE_GENERICO = 'No se pudo completar la operacion. Volve a intentar en un momento.';
const MENSAJE_SIN_CONTEXTO =
  'Los egresos son de una sede. Eligi una organizacion y un consultorio, y volve a entrar. Tu ' +
  'sesion sigue abierta.';

export function errorSinContextoDeEgreso(): ErrorEgreso {
  return { mensaje: MENSAJE_SIN_CONTEXTO, causa: 'sin-contexto', recargar: false };
}

export function traducirErrorEgreso(error: unknown): ErrorEgreso {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: MENSAJE_GENERICO, causa: 'otro', recargar: false };
  }
  if (error.esDeRed) {
    return {
      mensaje:
        'No se pudo contactar al servidor, asi que no sabemos si la operacion entro. Recarga ' +
        'antes de repetirla.',
      causa: 'red',
      recargar: true,
    };
  }
  if (error.faltaContexto) {
    return errorSinContextoDeEgreso();
  }

  switch (error.problemType) {
    case 'egreso-no-editable':
      return {
        mensaje:
          'El egreso ya no es un borrador: alguien lo confirmo o lo anulo. Un egreso confirmado ' +
          'no se corrige; si esta mal, se anula y se carga de nuevo.',
        causa: 'no-editable',
        recargar: true,
      };
    case 'egreso-no-confirmable':
      return {
        mensaje: 'El egreso ya no es un borrador, asi que no hay nada que confirmar. Recargalo.',
        causa: 'no-confirmable',
        recargar: true,
      };
    case 'egreso-sin-comprobante':
      return {
        mensaje:
          'Para confirmar hace falta el comprobante: cargale el tipo y el numero al borrador y ' +
          'volve a confirmar.',
        causa: 'sin-comprobante',
        recargar: false,
      };
    case 'egreso-ya-anulado':
      return { mensaje: 'Ese egreso ya estaba anulado.', causa: 'ya-anulado', recargar: true };
    case 'egreso-con-pagos': {
      const yaPagado = error.numeroDeExtension('yaPagado');
      return {
        mensaje:
          'El egreso tiene pagos vigentes' +
          (yaPagado === null ? '' : ` (${importeEnPalabras(yaPagado, undefined)})`) +
          '. Anula primero cada pago —eso devuelve la plata— y despues el egreso.',
        causa: 'con-pagos',
        recargar: true,
      };
    }
    case 'egreso-no-pagable':
      return {
        mensaje:
          'El egreso no admite pagos: tiene que estar confirmado y con saldo. Recargalo para ver ' +
          'como quedo.',
        causa: 'no-pagable',
        recargar: true,
      };
    case 'egreso-saldo-insuficiente': {
      const saldo = error.numeroDeExtension('saldoDisponible');
      return {
        mensaje:
          'El pago supera lo que se debe' +
          (saldo === null ? '' : `: el saldo pendiente es ${importeEnPalabras(saldo, undefined)}`) +
          '. No se registro nada.',
        causa: 'saldo-insuficiente',
        recargar: true,
      };
    }
    case 'egreso-comprobante-duplicado':
      return {
        mensaje:
          'Ese comprobante de ese beneficiario ya esta cargado en otro egreso. Revisa el numero.',
        causa: 'comprobante-duplicado',
        recargar: false,
      };
    case 'pago-egreso-ya-anulado':
      return { mensaje: 'Ese pago ya estaba anulado.', causa: 'pago-ya-anulado', recargar: true };
    case 'beneficiario-no-vinculado':
      return {
        mensaje:
          'Ese colaborador no tiene un vinculo vigente con la organizacion. Elegi otro o cargalo ' +
          'como beneficiario externo.',
        causa: 'beneficiario-no-vinculado',
        recargar: false,
      };
    case 'caja-no-abierta':
      return {
        mensaje:
          'Un pago en efectivo sale del cajon, y la caja de esta sede no esta abierta. Abrila o ' +
          'paga por otro medio.',
        causa: 'caja',
        recargar: false,
        irACaja: true,
      };
    case 'caja-saldo-insuficiente': {
      const saldo = error.numeroDeExtension('saldoDisponible');
      return {
        mensaje:
          'No hay tanto efectivo en el cajon' +
          (saldo === null ? '' : ` (hay ${importeEnPalabras(saldo, undefined)})`) +
          ', y la caja no puede quedar en negativo. Paga una parte o usa otro medio.',
        causa: 'caja',
        recargar: false,
        irACaja: true,
      };
    }
    case 'caja-moneda-distinta':
      return {
        mensaje: 'La moneda del egreso no coincide con la de la caja abierta. No se pago nada.',
        causa: 'caja',
        recargar: false,
        irACaja: true,
      };
    case 'movimiento-no-reversible':
      return {
        mensaje: 'El movimiento de caja de ese pago ya fue revertido. Recarga el egreso.',
        causa: 'pago-ya-anulado',
        recargar: true,
      };
    case 'egreso-de-liquidacion':
      return {
        mensaje:
          'Este egreso nacio de una liquidacion de honorarios: su importe, categoria, periodo y ' +
          'servicio salen de las clases liquidadas y no se corrigen a mano. Se pueden cambiar el ' +
          'concepto y el comprobante. Si el importe esta mal, anula el egreso —eso libera las ' +
          'clases— y volve a liquidar.',
        causa: 'de-liquidacion',
        recargar: true,
      };
    case 'borrador-de-honorarios-desactualizado': {
      const actual = error.numeroDeExtension('importeTotalActual');
      return {
        mensaje:
          'El borrador cambio desde que lo miraste —otra liquidacion, una asistencia corregida o ' +
          'una tarifa nueva—' +
          (actual === null ? '' : `: ahora da ${importeEnPalabras(actual, undefined)}`) +
          '. No se liquido nada. Revisa el borrador actualizado y volve a confirmar.',
        causa: 'borrador-desactualizado',
        recargar: true,
      };
    }
    case 'liquidacion-de-honorarios-vacia':
      return {
        mensaje:
          'No queda ninguna clase para liquidar en ese periodo: ya se liquidaron o no tienen ' +
          'honorario ni presentes. No se creo ningun egreso.',
        causa: 'liquidacion-vacia',
        recargar: true,
      };
    case 'concurrent-modification':
      return {
        mensaje:
          'Alguien cambio este egreso despues de que lo abriste, asi que no guardamos la ' +
          'correccion sobre datos viejos. No se piso nada: recarga el egreso y volve a corregirlo.',
        causa: 'version-vieja',
        recargar: true,
      };
    case 'idempotency-key-conflict':
      return {
        mensaje: 'Se reuso la clave de este intento con datos distintos. Volve a confirmar.',
        causa: 'clave-reusada',
        recargar: false,
        renovarClave: true,
      };
    default:
      break;
  }

  const detalle = error.problem?.detail;
  if (error.status === 403) {
    return {
      mensaje:
        'No tenes permiso para gestionar egresos en esta sede (hace falta el permiso de caja). ' +
        'Pediselo a quien administra el centro.',
      causa: 'sin-permiso',
      recargar: false,
    };
  }
  if (error.status === 404) {
    return {
      mensaje:
        'El egreso, el pago, la liquidacion o la oferta elegida no existen, o no son de esta sede.',
      causa: 'no-encontrado',
      recargar: false,
    };
  }
  if (error.status === 400) {
    return {
      mensaje: detalle || 'El servidor rechazo los datos. Revisalos.',
      causa: 'datos-invalidos',
      recargar: false,
    };
  }
  if (error.status === 409) {
    return {
      mensaje: detalle || 'Conflicto con lo que ya hay guardado. Recarga el egreso.',
      causa: 'conflicto',
      recargar: true,
    };
  }
  return { mensaje: detalle || MENSAJE_GENERICO, causa: 'otro', recargar: false };
}
