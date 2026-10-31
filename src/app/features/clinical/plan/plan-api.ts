import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { DisponibilidadService } from '../../../api/generated/api/disponibilidad.service';
import { PlanesDeTratamientoService } from '../../../api/generated/api/planes-de-tratamiento.service';
import { AvanceDelPlan } from '../../../api/generated/model/avance-del-plan';
import { ContextoDeAgenda } from '../../../api/generated/model/contexto-de-agenda';
import { CrearPlanTratamientoRequest } from '../../../api/generated/model/crear-plan-tratamiento-request';
import { ModificarPlanTratamientoRequest } from '../../../api/generated/model/modificar-plan-tratamiento-request';
import { PlanTratamiento } from '../../../api/generated/model/plan-tratamiento';
import { PlanTratamientoVersion } from '../../../api/generated/model/plan-tratamiento-version';
import { Justificacion, motivoDeAcceso } from '../services/historia-clinica-api';

/**
 * Unico punto del Plan de Tratamiento que toca el cliente generado (D-c, M11).
 *
 * <p>Cada metodo lleva el motivo de acceso de la visita (DP-03): el plan es contenido clinico y su
 * lectura se audita. Las transiciones mandan `expectedVersion`: sin ella dos pestañas se pisan en
 * silencio. Las reglas (no activar sin items, un solo plan vivo por caso) son del backend.
 */
@Injectable({ providedIn: 'root' })
export class PlanApi {
  private readonly planes = inject(PlanesDeTratamientoService);
  private readonly disponibilidad = inject(DisponibilidadService);

  /**
   * Cuantas sesiones de cada prestacion estan realizadas, programadas y pendientes, plan por plan.
   * Es de la agenda y no de la historia: exige `turno:read` y no lleva motivo de acceso.
   */
  contextoDeAgenda(consultorioId: number, personaId: number): Observable<ContextoDeAgenda> {
    return this.disponibilidad.contextoDeAgendaDePersona({ consultorioId, personaId });
  }

  /** Todos los planes del caso, incluidos los finalizados: son el recorrido terapeutico. */
  listar(casoClinicoId: number, justificacion: Justificacion): Observable<PlanTratamiento[]> {
    return this.planes.listarPlanesTratamiento({
      casoClinicoId,
      ...motivoDeAcceso(justificacion),
    });
  }

  crear(
    casoClinicoId: number,
    crearPlanTratamientoRequest: CrearPlanTratamientoRequest,
    justificacion: Justificacion,
  ): Observable<PlanTratamiento> {
    return this.planes.crearPlanTratamiento({
      casoClinicoId,
      crearPlanTratamientoRequest,
      ...motivoDeAcceso(justificacion),
    });
  }

  /** En BORRADOR edita en el lugar; en ACTIVO o SUSPENDIDO crea una version nueva. */
  modificar(
    planId: number,
    modificarPlanTratamientoRequest: ModificarPlanTratamientoRequest,
    justificacion: Justificacion,
  ): Observable<PlanTratamiento> {
    return this.planes.modificarPlanTratamiento({
      planId,
      modificarPlanTratamientoRequest,
      ...motivoDeAcceso(justificacion),
    });
  }

  activar(
    planId: number,
    expectedVersion: number,
    justificacion: Justificacion,
  ): Observable<PlanTratamiento> {
    return this.planes.activarPlanTratamiento({
      planId,
      transicionDePlan: { expectedVersion },
      ...motivoDeAcceso(justificacion),
    });
  }

  reanudar(
    planId: number,
    expectedVersion: number,
    justificacion: Justificacion,
  ): Observable<PlanTratamiento> {
    return this.planes.reanudarPlanTratamiento({
      planId,
      transicionDePlan: { expectedVersion },
      ...motivoDeAcceso(justificacion),
    });
  }

  suspender(
    planId: number,
    motivo: string,
    expectedVersion: number,
    justificacion: Justificacion,
  ): Observable<PlanTratamiento> {
    return this.planes.suspenderPlanTratamiento({
      planId,
      suspenderPlanTratamientoRequest: { motivo, expectedVersion },
      ...motivoDeAcceso(justificacion),
    });
  }

  finalizar(
    planId: number,
    motivo: string,
    expectedVersion: number,
    justificacion: Justificacion,
  ): Observable<PlanTratamiento> {
    return this.planes.finalizarPlanTratamiento({
      planId,
      finalizarPlanTratamientoRequest: { motivo, expectedVersion },
      ...motivoDeAcceso(justificacion),
    });
  }

  versiones(planId: number, justificacion: Justificacion): Observable<PlanTratamientoVersion[]> {
    return this.planes.listarVersionesDePlanTratamiento({
      planId,
      ...motivoDeAcceso(justificacion),
    });
  }

  /** Sin `numeroVersion`, el de la vigente. Todo lo que trae es derivado (RN-M11-001). */
  avance(
    planId: number,
    numeroVersion: number | null,
    justificacion: Justificacion,
  ): Observable<AvanceDelPlan> {
    return this.planes.verAvanceDePlanTratamiento({
      planId,
      ...(numeroVersion === null ? {} : { numeroVersion }),
      ...motivoDeAcceso(justificacion),
    });
  }
}
