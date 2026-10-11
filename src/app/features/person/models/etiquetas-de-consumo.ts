import { AlertaDeAutorizacionResponse } from '../../../api/generated/model/alerta-de-autorizacion-response';
import { AutorizacionElegibleResponse } from '../../../api/generated/model/autorizacion-elegible-response';
import { MovimientoResponse } from '../../../api/generated/model/movimiento-response';
import { SaldoAutorizacionResponse } from '../../../api/generated/model/saldo-autorizacion-response';
import { formatearInstante } from '../../../shared/utils/instantes';
import { fechaEnPalabras } from './etiquetas-de-ficha';

/**
 * Textos del saldo, el ledger, las alertas y el selector de autorizaciones (M17, C-4, D-f).
 *
 * <p>Todo lo que dicen sale de un campo del contrato. Ninguno recalcula un saldo: el backend ya
 * trae el veredicto, y una segunda cuenta en el cliente seria una segunda verdad.
 */

const TIPOS_DE_MOVIMIENTO: Record<string, string> = {
  CONSUMO: 'Consumo',
  REVERSION: 'Reversion',
  RESERVA: 'Reserva',
  LIBERACION_DE_RESERVA: 'Liberacion de reserva',
};

export function tipoDeMovimiento(movimiento: MovimientoResponse): string {
  return TIPOS_DE_MOVIMIENTO[movimiento.tipo ?? ''] ?? 'Movimiento';
}

/** Que produjo el hecho. Una reversion se explica por el consumo que compensa. */
export function origenDeMovimiento(movimiento: MovimientoResponse): string {
  if (movimiento.tipo === 'REVERSION' && movimiento.movimientoOrigenId != null) {
    return `Compensa el consumo #${movimiento.movimientoOrigenId}`;
  }
  if (movimiento.tipoOrigen === 'SESION') {
    return movimiento.referenciaOrigen != null
      ? `Cierre de la sesion #${movimiento.referenciaOrigen}`
      : 'Cierre de una sesion';
  }
  if (movimiento.tipoOrigen === 'MANUAL') {
    return 'Registrado a mano';
  }
  return 'Origen no informado';
}

/** El signo ya viene resuelto en `efectoSobreElSaldo`: aca solo se pone en palabras. */
export function efectoEnPalabras(movimiento: MovimientoResponse): string {
  const efecto = movimiento.efectoSobreElSaldo ?? 0;
  if (efecto < 0) {
    return `Resta ${-efecto} al saldo`;
  }
  if (efecto > 0) {
    return `Devuelve ${efecto} al saldo`;
  }
  return 'No mueve el saldo';
}

/** Ids de los consumos que ya tienen su reversion en el ledger. */
export function consumosRevertidos(
  movimientos: readonly MovimientoResponse[],
): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const movimiento of movimientos) {
    if (movimiento.tipo === 'REVERSION' && movimiento.movimientoOrigenId != null) {
      ids.add(movimiento.movimientoOrigenId);
    }
  }
  return ids;
}

/** Cantidad con tope o sin el. `null`/ausente en el contrato significa "sin tope declarado". */
export function cantidadOSinTope(valor: number | undefined | null): string {
  return valor === undefined || valor === null ? 'Sin tope declarado' : String(valor);
}

/**
 * El veredicto del saldo en una frase, con la causa.
 *
 * <p>Mismo criterio que `habilitaEnPalabras`: "no" sin motivo obliga a reconstruir cual de las
 * condiciones falla.
 */
export function veredictoDeSaldo(saldo: SaldoAutorizacionResponse): string {
  const dia = fechaEnPalabras(saldo.fecha);
  if (saldo.habilita === true) {
    return `Habilita a atender el ${dia}.`;
  }
  if (saldo.vencida === true) {
    return `No habilita el ${dia}: esta vencida.`;
  }
  if (saldo.agotada === true) {
    return `No habilita el ${dia}: no le queda saldo.`;
  }
  if (saldo.vigente === false) {
    return `No habilita el ${dia}: su vigencia no cubre ese dia.`;
  }
  return `No habilita el ${dia}: no esta aprobada o esta dada de baja.`;
}

/** La alerta "consumo a revisar" (DP-13), dicha como lo que es: una pregunta, no un error. */
export function alertaEnPalabras(alerta: AlertaDeAutorizacionResponse): string {
  const sesion = alerta.sesionId != null ? `la sesion #${alerta.sesionId}` : 'una sesion';
  const obligacion = alerta.obligacionId != null ? ` (obligacion #${alerta.obligacionId})` : '';
  const cuando = formatearInstante(alerta.generadaEn);
  return (
    `Se anulo la deuda de ${sesion}${obligacion}` +
    (cuando ? ` el ${cuando}` : '') +
    ', pero el consumo de esta autorizacion sigue en pie.'
  );
}

export function resolucionDeAlerta(alerta: AlertaDeAutorizacionResponse): string {
  const cuando = formatearInstante(alerta.resueltaEn);
  const como = alerta.resolucion === 'REVERTIDO' ? 'se revirtio el consumo' : 'resuelta';
  return `Resuelta: ${como}${cuando ? ` el ${cuando}` : ''}.`;
}

// -----------------------------------------------------------------------------------------
// Selector explicable
// -----------------------------------------------------------------------------------------

const MOTIVOS_NO_ELEGIBLE: Record<string, string> = {
  VENCIDA: 'No sirve: esta vencida. Hay que renovarla, ampliarle la cantidad no alcanza.',
  AGOTADA: 'No sirve: ya se consumieron todas las sesiones otorgadas.',
  AUN_NO_VIGENTE: 'No sirve todavia: su vigencia empieza despues de ese dia.',
  NO_APROBADA: 'No sirve: el financiador todavia no la aprobo, o la observo o rechazo.',
};

export function veredictoDeCandidata(candidata: AutorizacionElegibleResponse): string {
  if (candidata.habilita === true) {
    return 'Sirve ese dia.';
  }
  return MOTIVOS_NO_ELEGIBLE[candidata.motivoNoElegible ?? ''] ?? 'No sirve ese dia.';
}

export function saldoDeCandidata(candidata: AutorizacionElegibleResponse): string {
  if (candidata.cantidadAutorizada == null) {
    return `Sin tope declarado (${candidata.cantidadConsumida ?? 0} consumidas)`;
  }
  return `${candidata.saldo ?? 0} de ${candidata.cantidadAutorizada}`;
}

export function vencimientoDeCandidata(candidata: AutorizacionElegibleResponse): string {
  if (candidata.vigenciaHasta == null) {
    return 'No vence';
  }
  const dias = candidata.diasParaVencer;
  const faltan = dias != null && dias >= 0 ? ` (faltan ${dias} dias)` : '';
  return `Hasta el ${fechaEnPalabras(candidata.vigenciaHasta)}${faltan}`;
}

/**
 * La primera que sirve para esa practica, en el orden que ya trae el backend.
 *
 * <p>No reordena: la respuesta ya viene "primero las que habilitan y, dentro, la que vence antes",
 * que es el mismo criterio del cierre (C-4 §2.1). Solo filtra por practica, porque el endpoint no
 * lo hace.
 */
export function primeraQueSirve(
  candidatas: readonly AutorizacionElegibleResponse[],
  practicaId: number,
): AutorizacionElegibleResponse | null {
  return (
    candidatas.find(
      (candidata) => candidata.habilita === true && candidata.practicaId === practicaId,
    ) ?? null
  );
}
