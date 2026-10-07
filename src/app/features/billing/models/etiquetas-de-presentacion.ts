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

export function estadoDeItemEnPalabras(estado: string | undefined): string {
  switch (estado) {
    case PresentacionItemEstadoEnum.INCLUIDO:
      return 'Incluida';
    case PresentacionItemEstadoEnum.ACEPTADO:
      return 'Aceptada';
    case PresentacionItemEstadoEnum.DEBITADO:
      return 'Debitada';
    case PresentacionItemEstadoEnum.ANULADO:
      return 'Anulada';
    default:
      return estado ?? '';
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
      return 'La prestacion se dio en otra sede, y el convenio es de la sede.';
    case ReparoDePresentacionHallazgoEnum.FUERA_DEL_PERIODO:
      return 'La prestacion cae fuera del periodo del lote.';
    case ReparoDePresentacionHallazgoEnum.MONEDA_DISTINTA:
      return 'La deuda esta en otra moneda que el lote.';
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

/** Hoy en formato `AAAA-MM-DD`, en hora local: es lo que un `<input type="date">` espera. */
export function hoyIso(ahora: Date = new Date()): string {
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

/** `AAAA-MM-DD` → `DD/MM/AAAA`, sin pasar por `Date` para no correr el dia por zona horaria. */
export function fechaIsoEnPalabras(fecha: string | undefined): string {
  if (fecha === undefined || fecha === '') {
    return '';
  }
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha);
  return partes === null ? fecha : `${partes[3]}/${partes[2]}/${partes[1]}`;
}
