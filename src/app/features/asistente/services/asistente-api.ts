import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { AsistenteService } from '../../../api/generated/api/asistente.service';
import { ConfirmarAccion } from '../../../api/generated/model/confirmar-accion';
import { InterpretacionDto } from '../../../api/generated/model/interpretacion-dto';
import { ResultadoDeAccion } from '../../../api/generated/model/resultado-de-accion';
import { RespuestaAsistenteResponse } from '../../../api/generated/model/respuesta-asistente-response';

/** Una pregunta anterior de la charla, con la interpretación que devolvió el servidor. */
export interface TurnoPrevio {
  readonly pregunta: string;
  readonly interpretacion: InterpretacionDto;
}

/**
 * El asistente de datos de la sede (contrato 0.170.0). El servidor no guarda la charla: el
 * historial viaja en cada pregunta.
 */
@Injectable({ providedIn: 'root' })
export class AsistenteApi {
  private readonly api = inject(AsistenteService);

  consultar(
    consultorioId: number,
    pregunta: string,
    historial: readonly TurnoPrevio[],
    personaId?: number,
    rutaActual?: string,
  ): Observable<RespuestaAsistenteResponse> {
    return this.api.consultarAsistente({
      consultorioId,
      consultaAsistenteRequest: { pregunta, historial: [...historial], personaId, rutaActual },
    });
  }

  /** Graba una acción propuesta con lo que quedó en la tarjeta. Confirmar dos veces no graba dos. */
  confirmarAccion(
    consultorioId: number,
    accionId: number,
    tarjeta: ConfirmarAccion,
  ): Observable<ResultadoDeAccion> {
    return this.api.confirmarAccionDelAsistente({
      consultorioId,
      accionId,
      confirmarAccion: tarjeta,
    });
  }

  descartarAccion(consultorioId: number, accionId: number): Observable<unknown> {
    return this.api.descartarAccionDelAsistente({ consultorioId, accionId });
  }
}
