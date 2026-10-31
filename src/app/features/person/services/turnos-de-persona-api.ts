import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { TurnosService } from '../../../api/generated/api/turnos.service';
import { TurnosDePersona } from '../../../api/generated/model/turnos-de-persona';

/** Cuantos turnos muestra el 360 en "Proximos turnos". */
const CANTIDAD_DE_PROXIMOS = 5;

/**
 * Los turnos que muestra la ficha 360, aparte de `PersonApi`.
 *
 * <p>`PersonApi` entra en el bundle inicial por la precarga de la ficha, y `TurnosService` son 18 kB:
 * con esto se quedan en el chunk de la pantalla que los usa.
 */
@Injectable({ providedIn: 'root' })
export class TurnosDePersonaApi {
  private readonly turnos = inject(TurnosService);

  /** Los que vienen en esa sede, el mas cercano primero. */
  proximos(consultorioId: number, personaId: number): Observable<TurnosDePersona> {
    return this.turnos.listarTurnosDePersona({
      consultorioId,
      personaId,
      soloFuturos: true,
      size: CANTIDAD_DE_PROXIMOS,
    });
  }
}
