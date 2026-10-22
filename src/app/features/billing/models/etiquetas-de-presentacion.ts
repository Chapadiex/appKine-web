import { Presentacion, PresentacionEstadoEnum } from '../../../api/generated/model/presentacion';
import {
  PresentacionItem,
  PresentacionItemEstadoEnum,
} from '../../../api/generated/model/presentacion-item';
import { ReparoDePresentacionHallazgoEnum } from '../../../api/generated/model/reparo-de-presentacion';
import { RegistrarPagoDeFinanciadorMedioEnum } from '../../../api/generated/model/registrar-pago-de-financiador';

/**
 * Rotulos y reglas de habilitacion de las presentaciones a financiadores (M21, AKINE-07.04).
 *
 * <p>Las reglas de "que se puede hacer en cada estado" copian la tabla del §4 del diseno de 07.04.
 * <b>Son UX, no autoridad</b>: el backend vuelve a evaluar cada transicion y responde
 * `presentacion-no-editable` o `presentacion-estado-invalido` si la pantalla quedo vieja.
 */

export const ESTADOS_DE_PRESENTACION: readonly PresentacionEstadoEnum[] = [
  PresentacionEstadoEnum.BORRADOR,
  PresentacionEstadoEnum.PRESENTADA,
  PresentacionEstadoEnum.FACTURADA,
  PresentacionEstadoEnum.CONCILIADA,
  PresentacionEstadoEnum.ANULADA,
];

export function estadoDePresentacionEnPalabras(estado: string | undefined): string {
  switch (estado) {
    case PresentacionEstadoEnum.BORRADOR:
      return 'Borrador';
    case PresentacionEstadoEnum.PRESENTADA:
      return 'Presentada';
    case PresentacionEstadoEnum.FACTURADA:
      return 'Facturada';
    case PresentacionEstadoEnum.CONCILIADA:
      return 'Conciliada';
    case PresentacionEstadoEnum.ANULADA:
      return 'Anulada';
    default:
      return estado ?? '';
  }
}

export function claseDeEstadoDePresentacion(estado: string | undefined): string {
  switch (estado) {
    case PresentacionEstadoEnum.CONCILIADA:
      return 'marca-estado marca-estado--activa';
    case PresentacionEstadoEnum.ANULADA:
      return 'marca-estado marca-estado--revocada';
    default:
      return 'marca-estado marca-estado--suspendida';
  }
}

/**
 * Los seis estados de una prestacion dentro del lote, en el orden en que se recorren (DP-37).
 *
 * <p>`INCLUIDO`, `ACEPTADO` y `DEBITADO_PARCIAL` mantienen tomada la deuda; `DEBITADO` (debito
 * total), `ACEPTADO_PARCIAL` y `ANULADO` la liberan para otro lote.
 */
export const ESTADOS_DE_ITEM: readonly PresentacionItemEstadoEnum[] = [
  PresentacionItemEstadoEnum.INCLUIDO,
  PresentacionItemEstadoEnum.DEBITADO_PARCIAL,
  PresentacionItemEstadoEnum.DEBITADO,
  PresentacionItemEstadoEnum.ACEPTADO,
  PresentacionItemEstadoEnum.ACEPTADO_PARCIAL,
  PresentacionItemEstadoEnum.ANULADO,
];

export function estadoDeItemEnPalabras(estado: string | undefined): string {
  switch (estado) {
    case PresentacionItemEstadoEnum.INCLUIDO:
      return 'Incluida';
    case PresentacionItemEstadoEnum.ACEPTADO:
      return 'Aceptada';
    case PresentacionItemEstadoEnum.ACEPTADO_PARCIAL:
      return 'Aceptada en parte';
    case PresentacionItemEstadoEnum.DEBITADO:
      return 'Debitada';
    case PresentacionItemEstadoEnum.DEBITADO_PARCIAL:
      return 'Debitada en parte';
    case PresentacionItemEstadoEnum.ANULADO:
      return 'Anulada';
    default:
      return estado ?? '';
  }
}

/** Clase de la pastilla del estado del item: verde lo cobrado, rojo lo perdido, gris lo abierto. */
export function claseDeEstadoDeItem(estado: string | undefined): string {
  switch (estado) {
    case PresentacionItemEstadoEnum.ACEPTADO:
    case PresentacionItemEstadoEnum.ACEPTADO_PARCIAL:
      return 'marca-estado marca-estado--activa';
    case PresentacionItemEstadoEnum.DEBITADO:
    case PresentacionItemEstadoEnum.ANULADO:
      return 'marca-estado marca-estado--revocada';
    default:
      return 'marca-estado marca-estado--suspendida';
  }
}

/**
 * Que significa el estado para la deuda, en los dos casos que no se explican solos (DP-37 / U-11).
 * Vacio para los demas.
 */
export function detalleDeEstadoDeItem(estado: string | undefined): string {
  switch (estado) {
    case PresentacionItemEstadoEnum.DEBITADO_PARCIAL:
      return (
        'Sigue en el lote: al cerrarlo se salda lo presentado menos lo debitado, y lo debitado ' +
        'queda pendiente para presentarlo en otro lote.'
      );
    case PresentacionItemEstadoEnum.ACEPTADO_PARCIAL:
      return (
        'Se cobro lo presentado menos lo debitado. Lo debitado quedo pendiente en la deuda y ' +
        'vuelve a la bandeja de elegibles por ese saldo.'
      );
    case PresentacionItemEstadoEnum.DEBITADO:
      return 'Salio del lote: la deuda sigue pendiente por el total y se puede volver a presentar.';
    default:
      return '';
  }
}

/** Que significa cada hallazgo de la revision (RF-M21-003), dicho para quien arma el lote. */
export function hallazgoEnPalabras(hallazgo: string | undefined): string {
  switch (hallazgo) {
    case ReparoDePresentacionHallazgoEnum.OBLIGACION_ANULADA:
      return 'La deuda fue anulada: no se le reclama a nadie.';
    case ReparoDePresentacionHallazgoEnum.SIN_SALDO:
      return 'La deuda ya no tiene saldo: se cobro por otra via y presentarla seria reclamar dos veces.';
    case ReparoDePresentacionHallazgoEnum.DEUDA_DEL_PACIENTE:
      return 'Es deuda del paciente (particular o coseguro), no del financiador: se cobra en el mostrador.';
    case ReparoDePresentacionHallazgoEnum.FINANCIADOR_DISTINTO:
      return 'La deuda es de otro financiador.';
    case ReparoDePresentacionHallazgoEnum.SEDE_DISTINTA:
      return 'La prestación se dio en otra sede, y el convenio es de la sede.';
    case ReparoDePresentacionHallazgoEnum.FUERA_DEL_PERIODO:
      return 'La prestación cae fuera del periodo del lote.';
    case ReparoDePresentacionHallazgoEnum.MONEDA_DISTINTA:
      return 'La deuda esta en otra moneda que el lote.';
    case ReparoDePresentacionHallazgoEnum.SIN_ORDEN:
      return (
        'El convenio exigia orden medica y el paciente no tenia una vigente para esa cobertura el ' +
        'día de la prestación. Cargala en la ficha del paciente (ordenes y autorizaciones) o quita ' +
        'la prestación del lote.'
      );
    case ReparoDePresentacionHallazgoEnum.SIN_AUTORIZACION:
      return (
        'El convenio exigia autorización y no hay una aprobada de esa cobertura y práctica que ' +
        'cubra el día de la prestación. Cargala en la ficha del paciente (ordenes y ' +
        'autorizaciones) o quita la prestación del lote.'
      );
    case ReparoDePresentacionHallazgoEnum.CREDENCIAL_FALTANTE:
      return (
        'La credencial estaba vencida el día de la prestación, o la cobertura no tiene número de ' +
        'afiliado. No impide presentar, pero el financiador puede debitarla: regularizala en la ' +
        'ficha del paciente.'
      );
    default:
      return hallazgo ?? '';
  }
}

export const MEDIOS_DE_PAGO_DE_FINANCIADOR: readonly RegistrarPagoDeFinanciadorMedioEnum[] = [
  RegistrarPagoDeFinanciadorMedioEnum.TRANSFERENCIA,
  RegistrarPagoDeFinanciadorMedioEnum.EFECTIVO,
  RegistrarPagoDeFinanciadorMedioEnum.TARJETA_DEBITO,
  RegistrarPagoDeFinanciadorMedioEnum.TARJETA_CREDITO,
  RegistrarPagoDeFinanciadorMedioEnum.OTRO,
];

export function esBorrador(p: Presentacion | null): boolean {
  return p?.estado === PresentacionEstadoEnum.BORRADOR;
}

/** PRESENTADA o FACTURADA: admite debitos, pagos y conciliacion (§4 del diseno). */
export function estaEnCurso(p: Presentacion | null): boolean {
  return (
    p?.estado === PresentacionEstadoEnum.PRESENTADA ||
    p?.estado === PresentacionEstadoEnum.FACTURADA
  );
}

/** La factura se registra una vez y solo sobre un lote presentado. */
export function admiteFactura(p: Presentacion | null): boolean {
  return p?.estado === PresentacionEstadoEnum.PRESENTADA;
}

/** Solo un item que sigue vivo en el lote se puede debitar (`item-no-debitable` si no). */
export function esDebitable(item: PresentacionItem): boolean {
  return item.estado === PresentacionItemEstadoEnum.INCLUIDO;
}

/** `AAAA-MM-DD` → `DD/MM/AAAA`, sin pasar por `Date` para no correr el dia por zona horaria. */
export function fechaIsoEnPalabras(fecha: string | undefined): string {
  if (fecha === undefined || fecha === '') {
    return '';
  }
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha);
  return partes === null ? fecha : `${partes[3]}/${partes[2]}/${partes[1]}`;
}
