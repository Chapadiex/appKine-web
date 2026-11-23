import { ContratacionResponseSituacionDeCobroEnum } from '../../api/generated/model/contratacion-response';

/**
 * Donde esta un centro respecto de su periodo pagado (cobro mensual, contrato 0.191.0). Lo calcula
 * el servidor al leer; la pantalla solo lo rotula.
 *
 * <p>Vive en `core/` porque lo usan el shell (la franja del centro) y la consola de plataforma, y
 * un feature no importa de otro (ADR-0004).
 */
export type SituacionDeCobro = `${ContratacionResponseSituacionDeCobroEnum}`;

/** Rotulo de una situacion de cobro: clase de `marca-estado` y texto. */
export interface MarcaDeCobro {
  readonly clase: string;
  readonly texto: string;
}

const MARCAS: Readonly<Record<SituacionDeCobro, MarcaDeCobro>> = {
  SIN_CONTROL: { clase: 'marca-estado--neutra', texto: 'Sin control de cobro' },
  AL_DIA: { clase: 'marca-estado--activa', texto: 'Al día' },
  POR_VENCER: { clase: 'marca-estado--info', texto: 'Por vencer' },
  EN_GRACIA: { clase: 'marca-estado--suspendida', texto: 'Vencida, en gracia' },
  SOLO_LECTURA: { clase: 'marca-estado--suspendida', texto: 'Solo lectura por falta de pago' },
  SIN_ACCESO: { clase: 'marca-estado--revocada', texto: 'Sin acceso por falta de pago' },
};

export function marcaDeCobro(situacion: string | undefined): MarcaDeCobro {
  return MARCAS[(situacion ?? 'SIN_CONTROL') as SituacionDeCobro] ?? MARCAS.SIN_CONTROL;
}

/** Texto del motivo en el selector de contexto para un centro cerrado por falta de pago. */
export const MOTIVO_SIN_ACCESO = 'Sin acceso: suscripción cerrada por falta de pago';
