import { Egreso, EgresoEstadoEnum } from '../../../api/generated/model/egreso';
import { PagoDeEgreso, PagoDeEgresoEstadoEnum } from '../../../api/generated/model/pago-de-egreso';
import { RegistrarEgresoCategoriaEnum } from '../../../api/generated/model/registrar-egreso';
import { RegistrarPagoDeEgresoMedioEnum } from '../../../api/generated/model/registrar-pago-de-egreso';

/**
 * Textos de los egresos y sus pagos (M22, AKINE-07.05).
 *
 * <p>Las listas salen de los enums generados, no de listas escritas a mano: si el backend agrega
 * una categoria o un medio, la pantalla lo ofrece sola.
 */

export const ESTADOS_DE_EGRESO: readonly EgresoEstadoEnum[] = Object.values(EgresoEstadoEnum);

export const CATEGORIAS_DE_EGRESO: readonly RegistrarEgresoCategoriaEnum[] = Object.values(
  RegistrarEgresoCategoriaEnum,
);

export const MEDIOS_DE_PAGO_DE_EGRESO: readonly RegistrarPagoDeEgresoMedioEnum[] = Object.values(
  RegistrarPagoDeEgresoMedioEnum,
);

export function estadoDeEgresoEnPalabras(estado: string | undefined): string {
  switch (estado) {
    case EgresoEstadoEnum.BORRADOR:
      return 'Borrador';
    case EgresoEstadoEnum.CONFIRMADO:
      return 'Confirmado, a pagar';
    case EgresoEstadoEnum.PAGADO:
      return 'Pagado';
    case EgresoEstadoEnum.ANULADO:
      return 'Anulado';
    default:
      return estado ?? '';
  }
}

/** Reusa las tres marcas del design system, sin colores propios. */
export function claseDeEstadoDeEgreso(estado: string | undefined): string {
  switch (estado) {
    case EgresoEstadoEnum.PAGADO:
      return 'marca-estado marca-estado--activa';
    case EgresoEstadoEnum.ANULADO:
      return 'marca-estado marca-estado--revocada';
    default:
      return 'marca-estado marca-estado--suspendida';
  }
}

export function categoriaEnPalabras(categoria: string | undefined): string {
  switch (categoria) {
    case RegistrarEgresoCategoriaEnum.HONORARIOS_PROFESIONALES:
      return 'Honorarios profesionales';
    case RegistrarEgresoCategoriaEnum.SUELDOS:
      return 'Sueldos';
    case RegistrarEgresoCategoriaEnum.ALQUILER:
      return 'Alquiler';
    case RegistrarEgresoCategoriaEnum.SERVICIOS:
      return 'Servicios (luz, agua, internet)';
    case RegistrarEgresoCategoriaEnum.INSUMOS:
      return 'Insumos';
    case RegistrarEgresoCategoriaEnum.IMPUESTOS:
      return 'Impuestos';
    case RegistrarEgresoCategoriaEnum.MANTENIMIENTO:
      return 'Mantenimiento';
    case RegistrarEgresoCategoriaEnum.OTRO:
      return 'Otro';
    default:
      return categoria ?? '';
  }
}

/** Solo un borrador se edita o se confirma (`egreso-no-editable` / `egreso-no-confirmable`). */
export function esBorradorDeEgreso(egreso: Egreso | null): boolean {
  return egreso?.estado === EgresoEstadoEnum.BORRADOR;
}

/** Solo un confirmado con saldo admite pagos (`egreso-no-pagable`). */
export function admitePago(egreso: Egreso | null): boolean {
  return egreso?.estado === EgresoEstadoEnum.CONFIRMADO && (egreso.saldoPendiente ?? 0) > 0;
}

/** Un egreso anulado no se anula de nuevo (`egreso-ya-anulado`). */
export function admiteAnulacion(egreso: Egreso | null): boolean {
  return egreso !== null && egreso.estado !== EgresoEstadoEnum.ANULADO;
}

export function pagoVigente(pago: PagoDeEgreso): boolean {
  return pago.estado === PagoDeEgresoEstadoEnum.CONFIRMADO;
}

/** `true` si el egreso tiene pagos que todavia no se anularon (`egreso-con-pagos`). */
export function tienePagosVigentes(egreso: Egreso | null): boolean {
  return (egreso?.pagos ?? []).some(pagoVigente);
}

/** `AAAA-MM-01` del mes de `hoy` (`AAAA-MM-DD`). Sin `Date`: no corre el dia por zona horaria. */
export function primeroDelMes(hoy: string): string {
  return `${hoy.slice(0, 8)}01`;
}
