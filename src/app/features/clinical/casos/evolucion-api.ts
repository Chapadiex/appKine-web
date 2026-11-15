import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { EvolucionDelCasoService } from '../../../api/generated/api/evolucion-del-caso.service';
import { EvolucionDelCasoResponse } from '../../../api/generated/model/evolucion-del-caso-response';
import { Justificacion, motivoDeAcceso } from '../services/historia-clinica-api';

/**
 * Unico punto de la evolucion del caso que toca el cliente generado (M31, RF-M31-001).
 *
 * <p>La evolucion muestra sesiones de todo el equipo del caso: es contenido clinico y viaja con el
 * motivo de la visita, igual que el caso.
 */
@Injectable({ providedIn: 'root' })
export class EvolucionApi {
  private readonly evolucion = inject(EvolucionDelCasoService);

  ver(
    consultorioId: number,
    casoId: number,
    justificacion: Justificacion,
  ): Observable<EvolucionDelCasoResponse> {
    return this.evolucion.verEvolucionDelCaso({
      consultorioId,
      casoId,
      ...motivoDeAcceso(justificacion),
    });
  }
}
