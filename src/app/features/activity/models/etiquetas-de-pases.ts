import { ConsumoDeCredito } from '../../../api/generated/model/consumo-de-credito';
import { MovimientoPase } from '../../../api/generated/model/movimiento-pase';
import { Pase } from '../../../api/generated/model/pase';

/**
 * Vocabulario de productos de pack y pases (M29, AKINE-08.06).
 *
 * <p><b>Pase no es deuda ni cobro.</b> Vender un pase genera una obligacion a nombre de la persona
 * (DP-06), que se cobra aparte; consumir un credito no toca esa deuda (RN-M29-006). Por eso nada de
 * aca habla de "pagado": el saldo de un pase son creditos, no plata.
 *
 * <p>No se hace aritmetica con importes: se formatean y nada mas, igual que en la cuenta corriente.
 */

const ESTADOS_DE_PASE: Readonly<Record<string, string>> = {
  ACTIVO: 'Activo',
  AGOTADO: 'Agotado',
  VENCIDO: 'Vencido',
  ANULADO: 'Anulado',
};

export function etiquetaDeEstadoDePase(pase: Pase): string {
  // El backend evalua el vencimiento por fecha y todavia no hay job que escriba `VENCIDO` (08.07):
  // un pase ACTIVO fuera de vigencia se lee como vencido, que es lo que es.
  if (pase.estado === 'ACTIVO' && pase.vigente === false) {
    return 'Vencido';
  }
  return (pase.estado && ESTADOS_DE_PASE[pase.estado]) || 'Sin estado';
}

/** Marca del design system para el estado. */
export function claseDeEstadoDePase(pase: Pase): string {
  if (pase.estado === 'ACTIVO' && pase.vigente !== false) {
    return 'marca-estado marca-estado--activa';
  }
  if (pase.estado === 'AGOTADO') {
    return 'marca-estado marca-estado--suspendida';
  }
  return 'marca-estado marca-estado--revocada';
}

const TIPOS_DE_MOVIMIENTO: Readonly<Record<string, string>> = {
  COMPRA: 'Compra',
  CONSUMO: 'Consumo',
  AJUSTE: 'Ajuste',
  DEVOLUCION: 'Devolucion',
  VENCIMIENTO: 'Vencimiento',
};

const ORIGENES_DE_MOVIMIENTO: Readonly<Record<string, string>> = {
  VENTA: 'venta del pase',
  ASISTENCIA: 'asistencia a una clase',
  CANCELACION: 'cancelacion de una clase',
  AJUSTE_MANUAL: 'ajuste manual',
  VENCIMIENTO: 'vencimiento',
};

export function etiquetaDeMovimiento(movimiento: MovimientoPase): string {
  return (movimiento.tipo && TIPOS_DE_MOVIMIENTO[movimiento.tipo]) || 'Movimiento';
}

export function origenDeMovimiento(movimiento: MovimientoPase): string {
  return (movimiento.origenTipo && ORIGENES_DE_MOVIMIENTO[movimiento.origenTipo]) || '';
}

/** `+8`, `-1`: el signo es lo que explica como se paso de 8 a 5 (CA-M29-009-06). */
export function cantidadConSigno(cantidad: number | undefined): string {
  if (cantidad === undefined) {
    return '';
  }
  return cantidad > 0 ? `+${cantidad}` : String(cantidad);
}

export function creditosEnPalabras(creditos: number | undefined): string {
  if (creditos === undefined) {
    return '';
  }
  return creditos === 1 ? '1 credito' : `${creditos} creditos`;
}

/**
 * Un importe con la moneda del dato. Si la moneda no es un ISO que el navegador conozca, cae al
 * numero sin simbolo: `Intl.NumberFormat` lanza con un codigo invalido.
 */
export function importeDePase(valor: number | undefined, moneda: string | undefined): string {
  if (valor === undefined || !Number.isFinite(valor)) {
    return '';
  }
  if (moneda) {
    try {
      return new Intl.NumberFormat('es-AR', { style: 'currency', currency: moneda }).format(valor);
    } catch {
      // Sigue con el formato numerico.
    }
  }
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valor);
}

/**
 * Lo que la asistencia hizo con el pase de la persona (RN-M29-005, CA-M19-009-06), o `null` si no
 * hay nada que decir (`NO_APLICA`, `SIN_CAMBIO` o sin dato).
 *
 * <p>`SIN_PASE_ELEGIBLE` <b>no es un error</b>: la asistencia quedo registrada igual —asistencia y
 * economia son independientes—. Se avisa para que recepcion le ofrezca un pase a la persona.
 */
export function avisoDeConsumo(consumo: ConsumoDeCredito | undefined): string | null {
  switch (consumo?.efecto) {
    case 'CONSUMIDO':
      return `consumio un credito del pase; le quedan ${creditosEnPalabras(consumo.saldo ?? 0)}.`;
    case 'DEVUELTO':
      return `se le devolvio el credito al pase; ahora tiene ${creditosEnPalabras(consumo.saldo ?? 0)}.`;
    case 'SIN_PASE_ELEGIBLE':
      return (
        'no tiene un pase vigente con creditos para esta clase. La asistencia quedo registrada ' +
        'igual; no se consumio nada.'
      );
    default:
      return null;
  }
}
