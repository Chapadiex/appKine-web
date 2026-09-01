import { MedioDeCobroMedioEnum } from '../../../api/generated/model/medio-de-cobro';

/**
 * Textos del cobro (M19, AKINE-07.02).
 *
 * <p>Igual que `etiquetas-de-obligacion.ts`: <b>aca no se hace aritmetica de plata</b>. El
 * formateo de importes sigue siendo de ese archivo —hay una sola forma de escribir un importe en
 * esta feature— y las cuentas viven en `dinero.ts`, en centavos enteros.
 */

/**
 * Los cinco medios, en el orden en que se usan en un mostrador.
 *
 * <p>Sale del enum generado y no de una lista escrita a mano: si el backend agrega un medio, esto
 * lo ofrece solo. Una lista propia se quedaria vieja en silencio y el operador elegiria
 * "efectivo" para algo que no lo es, que es exactamente lo que descuadra un arqueo sin dejar
 * rastro.
 */
export const MEDIOS_DE_COBRO: readonly MedioDeCobroMedioEnum[] = [
  MedioDeCobroMedioEnum.EFECTIVO,
  MedioDeCobroMedioEnum.TRANSFERENCIA,
  MedioDeCobroMedioEnum.TARJETA_DEBITO,
  MedioDeCobroMedioEnum.TARJETA_CREDITO,
  MedioDeCobroMedioEnum.OTRO,
];

/**
 * Rotulo de un medio de pago.
 *
 * <p>`OTRO` no se rotula "Otro" a secas: existe para billeteras virtuales, cheques y descuentos de
 * convenio, y un rotulo que no lo diga hace que nadie lo elija.
 */
export function medioEnPalabras(medio: string | undefined): string {
  switch (medio) {
    case MedioDeCobroMedioEnum.EFECTIVO:
      return 'Efectivo';
    case MedioDeCobroMedioEnum.TRANSFERENCIA:
      return 'Transferencia';
    case MedioDeCobroMedioEnum.TARJETA_DEBITO:
      return 'Tarjeta de debito';
    case MedioDeCobroMedioEnum.TARJETA_CREDITO:
      return 'Tarjeta de credito';
    case MedioDeCobroMedioEnum.OTRO:
      return 'Otro (billetera, cheque, convenio)';
    default:
      return medio ?? '';
  }
}

/** Fecha y hora legibles de un instante UTC. Un comprobante sin hora no se puede ubicar en el dia. */
export function instanteEnPalabras(instante: string | undefined): string {
  if (instante === undefined || instante === '') {
    return '';
  }
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(fecha);
}
