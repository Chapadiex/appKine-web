import { AvanceDelPlan } from '../../../api/generated/model/avance-del-plan';
import { OfertaResponse } from '../../../api/generated/model/oferta-response';
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
