import { MovimientoDeCajaTipoEnum } from '../../../api/generated/model/movimiento-de-caja';

/** Como se lee el tipo de un movimiento de caja (M20). */
export function tipoDeMovimientoEnPalabras(tipo: string | undefined): string {
  switch (tipo) {
    case MovimientoDeCajaTipoEnum.INGRESO:
      return 'Ingreso';
    case MovimientoDeCajaTipoEnum.EGRESO:
      return 'Egreso';
    case MovimientoDeCajaTipoEnum.REVERSION_DE_INGRESO:
      return 'Reversion de ingreso';
    case MovimientoDeCajaTipoEnum.REVERSION_DE_EGRESO:
      return 'Reversion de egreso';
    default:
      return tipo ?? '';
  }
}

/**
 * `true` si el movimiento saca plata. El importe del contrato es siempre positivo: el signo lo da
 * el tipo, y una reversion de ingreso resta tanto como un egreso.
 */
export function restaDelSaldo(tipo: string | undefined): boolean {
  return (
    tipo === MovimientoDeCajaTipoEnum.EGRESO ||
    tipo === MovimientoDeCajaTipoEnum.REVERSION_DE_INGRESO
  );
}
