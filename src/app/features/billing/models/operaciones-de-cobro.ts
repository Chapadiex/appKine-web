import { Cobro, CobroEstadoEnum } from '../../../api/generated/model/cobro';
import { Obligacion, ObligacionEstadoEnum } from '../../../api/generated/model/obligacion';
import { ReintegrarSaldoAFavorMedioEnum } from '../../../api/generated/model/reintegrar-saldo-a-favor';
import { aCentavos, sumaDeCentavos } from './dinero';

/**
 * Reglas de UX de las operaciones posteriores sobre un cobro (F-3, contrato 0.54.0).
 *
 * <p>Todo esto es <b>solo UX</b>: el backend rechaza igual con `cobro-anulado`,
 * `cobro-con-reintegros` o `saldo-a-favor-insuficiente` y es la autoridad. Lo que evita es ofrecer
 * un boton que sabemos que va a fallar sin decir por que. Las cuentas van en centavos enteros
 * (`dinero.ts`): nada de sumar flotantes.
 */

/** Los medios por los que puede salir un reintegro, del enum generado y no de una lista propia. */
export const MEDIOS_DE_REINTEGRO: readonly ReintegrarSaldoAFavorMedioEnum[] = [
  ReintegrarSaldoAFavorMedioEnum.EFECTIVO,
  ReintegrarSaldoAFavorMedioEnum.TRANSFERENCIA,
  ReintegrarSaldoAFavorMedioEnum.TARJETA_DEBITO,
  ReintegrarSaldoAFavorMedioEnum.TARJETA_CREDITO,
  ReintegrarSaldoAFavorMedioEnum.OTRO,
];

/** Saldo a favor del cobro en centavos; cero si no vino. */
export function saldoAFavorEnCentavos(cobro: Cobro): number {
  return Math.max(aCentavos(cobro.saldoAFavor) ?? 0, 0);
}

/**
 * Lo que el cobro ya devolvio, en centavos.
 *
 * <p>El contrato no publica la lista de reintegros, pero si la invariante: `total = imputaciones +
 * saldo a favor + reintegrado`. Despejar es exacto en centavos enteros.
 */
export function reintegradoEnCentavos(cobro: Cobro): number {
  const total = aCentavos(cobro.total) ?? 0;
  const imputado = sumaDeCentavos((cobro.imputaciones ?? []).map((i) => aCentavos(i.importe) ?? 0));
  return Math.max(total - imputado - saldoAFavorEnCentavos(cobro), 0);
}

export function estaAnulado(cobro: Cobro): boolean {
  return cobro.estado === CobroEstadoEnum.ANULADO;
}

/** Por que no se puede anular este cobro, o `null` si se puede. */
export function motivoParaNoAnular(cobro: Cobro): string | null {
  if (estaAnulado(cobro)) {
    return 'ya esta anulado.';
  }
  if (reintegradoEnCentavos(cobro) > 0) {
    return (
      'ya devolvio parte de su saldo a favor, y anularlo sacaria esa plata dos veces del cajon. ' +
      'Si hay que corregir lo devuelto, se hace con un ingreso manual en la caja.'
    );
  }
  return null;
}

/** Por que no se puede reintegrar nada de este cobro, o `null` si se puede. */
export function motivoParaNoReintegrar(cobro: Cobro): string | null {
  if (estaAnulado(cobro)) {
    return 'esta anulado.';
  }
  if (saldoAFavorEnCentavos(cobro) <= 0) {
    return 'no tiene saldo a favor.';
  }
  return null;
}

/**
 * Las deudas a las que se puede imputar el saldo a favor de este cobro.
 *
 * <p>Misma sede y misma moneda que el cobro, y con saldo: el backend exige las dos primeras
 * (decision 3 del diseno F-3) y la tercera es la que hace que imputar tenga sentido.
 */
export function deudasImputables(
  cobro: Cobro,
  obligaciones: readonly Obligacion[],
): readonly Obligacion[] {
  return obligaciones.filter(
    (deuda) =>
      deuda.consultorioId === cobro.consultorioId &&
      deuda.moneda === cobro.moneda &&
      deuda.estado !== ObligacionEstadoEnum.ANULADA &&
      deuda.estado !== ObligacionEstadoEnum.PAGADA &&
      (aCentavos(deuda.saldo) ?? 0) > 0,
  );
}

/**
 * Una clave de idempotencia nueva.
 *
 * <p>`crypto.randomUUID` no esta en contextos inseguros ni en algunos runtimes de test, asi que
 * hay respaldo: una clave debil solo es peor que ninguna si se repite.
 */
export function nuevaClaveDeIntento(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `akine-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
