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

/**
 * El estado tal como lo escribe el backend. Desde 08.07 `VENCIDO` es real: lo pone el job de
 * vencimiento junto con el movimiento que explica los creditos que se pierden (CA-M29-006-06). Un
 * `ACTIVO` con `vigente = false` ya no se lee como vencido: puede ser un abono cuyo periodo todavia
 * no empezo, o uno que vencio hace minutos y el job no paso. Eso lo dice {@link avisoDeVigencia}.
 */
export function etiquetaDeEstadoDePase(pase: Pase): string {
  return (pase.estado && ESTADOS_DE_PASE[pase.estado]) || 'Sin estado';
}

/** Marca del design system para el estado. */
export function claseDeEstadoDePase(pase: Pase): string {
  if (pase.estado === 'ACTIVO') {
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

/**
 * Por que un pase ACTIVO no cubre clases hoy, o `null` si las cubre o no esta activo. `hoy` es el
 * dia de la sede (AAAA-MM-DD).
 */
export function avisoDeVigencia(pase: Pase, hoy: string): string | null {
  if (pase.estado !== 'ACTIVO' || pase.vigente !== false) {
    return null;
  }
  if (pase.vigenciaDesde && pase.vigenciaDesde > hoy) {
    return `Empieza el ${fechaCorta(pase.vigenciaDesde)}`;
  }
  if (pase.vigenciaHasta && pase.vigenciaHasta < hoy) {
    return 'Termino su vigencia; el vencimiento se registra en la proxima hora';
  }
  return 'No cubre clases hoy';
}

function fechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.split('-');
  return dia && mes && anio ? `${dia}/${mes}/${anio}` : iso;
}

/** Un abono cubre un periodo; un pack, dias desde la compra. Sin tipo (antes de 0.109.0): pack. */
export function esAbono(pase: { readonly tipo?: string }): boolean {
  return pase.tipo === 'ABONO';
}

export function etiquetaDeTipoDePase(pase: { readonly tipo?: string }): string {
  return esAbono(pase) ? 'Abono' : 'Pack';
}

export function etiquetaDeMovimiento(movimiento: MovimientoPase): string {
  return (movimiento.tipo && TIPOS_DE_MOVIMIENTO[movimiento.tipo]) || 'Movimiento';
}

/**
 * De donde salio el movimiento. Dos casos se explican con una frase entera, porque el origen solo no
 * alcanza: la devolucion de una clase cancelada (RF-M29-004) y el vencimiento (RF-M29-006).
 */
export function origenDeMovimiento(movimiento: MovimientoPase): string {
  if (movimiento.tipo === 'DEVOLUCION' && movimiento.origenTipo === 'CANCELACION') {
    return 'se cancelo la clase: el credito vuelve al pase';
  }
  if (movimiento.tipo === 'VENCIMIENTO') {
    return 'vencio el pase: los creditos que quedaban se pierden';
  }
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
 *
 * <p>Sin `pase:read` en la sede (hoy el PROFESIONAL, U-46 c) viaja solo el `efecto`: ni
 * `paseId` ni `saldo`. Se dice que consumio o devolvio, sin inventar un saldo de cero.
 */
export function avisoDeConsumo(consumo: ConsumoDeCredito | undefined): string | null {
  switch (consumo?.efecto) {
    case 'CONSUMIDO':
      return consumo.saldo === undefined
        ? 'consumio un credito del pase.'
        : `consumio un credito del pase; le quedan ${creditosEnPalabras(consumo.saldo)}.`;
    case 'DEVUELTO':
      return consumo.saldo === undefined
        ? 'se le devolvio el credito al pase.'
        : `se le devolvio el credito al pase; ahora tiene ${creditosEnPalabras(consumo.saldo)}.`;
    case 'SIN_PASE_ELEGIBLE':
      return (
        'no tiene un pase vigente con creditos para esta clase. La asistencia quedo registrada ' +
        'igual; no se consumio nada.'
      );
    default:
      return null;
  }
}

/**
 * DP-40 (0.133.0): la renovacion se apaga sola cuando quien la autorizo ya no puede vender en la
 * sede (desvinculado, cambio de rol o de sede, permiso quitado). El contrato no tiene un codigo
 * para esa causa: el backend escribe en `renovacionOmitidaMotivo` el texto fijo de
 * `ApagadoDeRenovaciones.MOTIVO`, y se reconoce por su parte estable.
 */
export function renovacionApagadaPorAutorizante(motivo: string | undefined): boolean {
  return (motivo ?? '').toLowerCase().includes('ya no puede vender');
}
