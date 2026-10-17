import { AvanceDelPlan } from '../../../api/generated/model/avance-del-plan';
import { OfertaResponse } from '../../../api/generated/model/oferta-response';
import { PlanItemPlanificado } from '../../../api/generated/model/plan-item-planificado';
import { PlanTratamiento } from '../../../api/generated/model/plan-tratamiento';
import { diaEnPalabras } from '../models/etiquetas-de-casos';

/**
 * Los avisos del plan (D-c). <b>Ninguno bloquea nada</b>: RN-M11-004 dice que completar lo
 * planificado no finaliza el plan ni cierra el caso, y lo mismo vale para una oferta que vencio
 * —la baja no cascadea—. Son lo que el profesional necesita ver para decidir.
 *
 * <p>Todo sale de datos del contrato: el avance (derivado por el backend), la vigencia de las
 * ofertas de la sede y la duracion estimada desde la activacion. Nada se inventa aca.
 */
export function advertenciasDelPlan(
  plan: PlanTratamiento,
  avance: AvanceDelPlan | null,
  ofertas: readonly OfertaResponse[],
  hoy: string,
): string[] {
  const avisos: string[] = [];
  const vivo = plan.estado === 'ACTIVO' || plan.estado === 'SUSPENDIDO';
  const fin = finEstimado(plan);

  if (vivo && fin !== null && fin < hoy) {
    avisos.push(
      `La duracion estimada del plan termino el ${diaEnPalabras(fin)}. Revisalo: modificarlo ` +
        'deja una version nueva, y finalizarlo es una decision clinica.',
    );
  }

  if (vivo && avance?.completo) {
    avisos.push(
      'Ya se realizaron todas las sesiones planificadas. El plan no se finaliza solo: la decision ' +
        'es clinica.',
    );
  }

  for (const item of avance?.items ?? []) {
    const nombre = item.ofertaNombre ?? `Oferta #${item.ofertaId}`;
    const autorizadas = item.autorizadas;
    if (autorizadas !== undefined && autorizadas !== null) {
      if ((item.realizadas ?? 0) > autorizadas) {
        avisos.push(
          `${nombre}: se realizaron ${item.realizadas} sesiones y hay ${autorizadas} autorizadas.`,
        );
      } else if ((item.planificadas ?? 0) > autorizadas) {
        avisos.push(
          `${nombre}: hay ${item.planificadas} sesiones planificadas y ${autorizadas} autorizadas. ` +
            'Lo planificado y lo autorizado son valores distintos (RN-M11-002).',
        );
      }
    }
  }

  if (vivo) {
    for (const item of plan.versionVigente?.items ?? []) {
      const vigencia = vigenciaDeAutorizacion(item, hoy);
      if (vigencia?.estado === 'vencida') {
        avisos.push(
          `${item.ofertaNombre ?? `Oferta #${item.ofertaId}`}: la autorizacion vencio el ` +
            `${diaEnPalabras(item.autorizacionVigenciaHasta)}. Las sesiones que siguen no la ` +
            'consumen.',
        );
      }
    }
  }

  if (vivo) {
    const ofertasDelPlan = new Set(
      (plan.versionVigente?.items ?? []).map((i) => i.ofertaId).filter((id) => id !== undefined),
    );
    for (const ofertaId of ofertasDelPlan) {
      const oferta = ofertas.find((o) => o.id === ofertaId);
      if (oferta === undefined) continue;
      const nombre = oferta.nombreComercial ?? `Oferta #${ofertaId}`;
      if (oferta.estado === 'INACTIVO' || oferta.vigenteHoy === false) {
        avisos.push(
          `${nombre} ya no esta vigente en la sede. El plan sigue valido, pero no se puede volver ` +
            'a planificar con ella.',
        );
      } else if (oferta.vigenciaHasta && fin !== null && oferta.vigenciaHasta < fin) {
        avisos.push(
          `${nombre} vence el ${diaEnPalabras(oferta.vigenciaHasta)}, antes del fin estimado del ` +
            `plan (${diaEnPalabras(fin)}).`,
        );
      }
    }
  }

  return avisos;
}

/**
 * Activacion + duracion en semanas, como fecha `YYYY-MM-DD`, o `null` si falta alguno. La regla
 * de recurrencia es una propuesta (el plan no agenda nada), asi que esto es una estimacion.
 */
export function finEstimado(plan: PlanTratamiento): string | null {
  const semanas = plan.versionVigente?.duracionSemanas;
  if (!plan.activadoEn || !semanas) return null;
  const inicio = new Date(plan.activadoEn);
  if (Number.isNaN(inicio.getTime())) return null;
  inicio.setUTCDate(inicio.getUTCDate() + semanas * 7);
  return inicio.toISOString().slice(0, 10);
}

/** Donde esta la autorizacion de un item respecto del dia de la sede. */
export type EstadoDeVigencia = 'vigente' | 'vencida' | 'futura' | 'no-disponible';

export interface VigenciaDeAutorizacion {
  readonly estado: EstadoDeVigencia;
  /** En palabras, con el estado dicho: el color de la marca no alcanza (WCAG 1.4.1). */
  readonly texto: string;
}

/**
 * La vigencia de la autorizacion de M17 que respalda un item (0.107.0, `appKine-api` #132), o
 * `null` si el item no tiene autorizacion. Se compara contra `hoy` —el dia de la sede, de
 * `DiaDeLaSede`—: un navegador en UTC ya esta en el dia siguiente entre las 21 y las 24 de
 * Cordoba, y daria por vencida una autorizacion que vence hoy.
 *
 * <p>Las fechas son de calendario y el `hasta` es inclusivo. Sin fechas con autorizacion es que el
 * backend no la pudo resolver (dada de baja); con `desde` y sin `hasta`, que no tiene fin.
 */
export function vigenciaDeAutorizacion(
  item: PlanItemPlanificado,
  hoy: string,
): VigenciaDeAutorizacion | null {
  if (item.autorizacionId === undefined || item.autorizacionId === null) return null;
  const desde = item.autorizacionVigenciaDesde;
  const hasta = item.autorizacionVigenciaHasta;
  if (!desde && !hasta) {
    return { estado: 'no-disponible', texto: 'autorizacion no disponible (dada de baja)' };
  }
  if (hasta && hasta.slice(0, 10) < hoy) {
    return { estado: 'vencida', texto: `autorizacion vencida el ${diaEnPalabras(hasta)}` };
  }
  if (desde && desde.slice(0, 10) > hoy) {
    return {
      estado: 'futura',
      texto: `autorizacion vigente recien desde el ${diaEnPalabras(desde)}`,
    };
  }
  const tramo = hasta
    ? `hasta el ${diaEnPalabras(hasta)} inclusive`
    : `desde el ${diaEnPalabras(desde)}, sin vencimiento`;
  return { estado: 'vigente', texto: `autorizacion vigente ${tramo}` };
}
