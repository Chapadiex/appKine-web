import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { PlanesDeTratamientoService } from '../../../api/generated/api/planes-de-tratamiento.service';
import { AvanceDelPlan } from '../../../api/generated/model/avance-del-plan';
import { CrearPlanTratamientoRequest } from '../../../api/generated/model/crear-plan-tratamiento-request';
import { FinalizarPlanTratamientoRequest } from '../../../api/generated/model/finalizar-plan-tratamiento-request';
import { ModificarPlanTratamientoRequest } from '../../../api/generated/model/modificar-plan-tratamiento-request';
import { PlanTratamiento } from '../../../api/generated/model/plan-tratamiento';
import { PlanTratamientoVersion } from '../../../api/generated/model/plan-tratamiento-version';
import { SuspenderPlanTratamientoRequest } from '../../../api/generated/model/suspender-plan-tratamiento-request';

/**
 * Unico punto de la feature de plan de tratamiento que toca el cliente generado.
 *
 * <p>Mismo criterio que `ClinicalApi`: la pantalla depende de esta clase y de los tipos del
 * contrato, nunca del servicio generado directo. Las transiciones mandan `expectedVersion`: sin
 * ella dos pestañas se pisan en silencio. Las reglas de negocio (p. ej. no activar sin items)
 * son del backend; aca no se reimplementan.
 */
@Injectable({ providedIn: 'root' })
export class PlanApi {
  private readonly planes = inject(PlanesDeTratamientoService);

  listar(casoClinicoId: number): Observable<PlanTratamiento[]> {
    return this.planes.listarPlanesTratamiento({ casoClinicoId });
  }

  ver(planId: number): Observable<PlanTratamiento> {
    return this.planes.verPlanTratamiento({ planId });
  }

  crear(
    casoClinicoId: number,
    crearPlanTratamientoRequest: CrearPlanTratamientoRequest,
  ): Observable<PlanTratamiento> {
    return this.planes.crearPlanTratamiento({ casoClinicoId, crearPlanTratamientoRequest });
  }

  modificar(
    planId: number,
    modificarPlanTratamientoRequest: ModificarPlanTratamientoRequest,
  ): Observable<PlanTratamiento> {
    return this.planes.modificarPlanTratamiento({ planId, modificarPlanTratamientoRequest });
  }

  activar(planId: number, expectedVersion: number): Observable<PlanTratamiento> {
    return this.planes.activarPlanTratamiento({ planId, transicionDePlan: { expectedVersion } });
  }

  suspender(
    planId: number,
    suspenderPlanTratamientoRequest: SuspenderPlanTratamientoRequest,
  ): Observable<PlanTratamiento> {
    return this.planes.suspenderPlanTratamiento({ planId, suspenderPlanTratamientoRequest });
  }

  reanudar(planId: number, expectedVersion: number): Observable<PlanTratamiento> {
    return this.planes.reanudarPlanTratamiento({ planId, transicionDePlan: { expectedVersion } });
  }

  finalizar(
    planId: number,
    finalizarPlanTratamientoRequest: FinalizarPlanTratamientoRequest,
  ): Observable<PlanTratamiento> {
    return this.planes.finalizarPlanTratamiento({ planId, finalizarPlanTratamientoRequest });
  }

  versiones(planId: number): Observable<PlanTratamientoVersion[]> {
    return this.planes.listarVersionesDePlanTratamiento({ planId });
  }

  avance(planId: number): Observable<AvanceDelPlan> {
    return this.planes.verAvanceDePlanTratamiento({ planId });
  }
}
