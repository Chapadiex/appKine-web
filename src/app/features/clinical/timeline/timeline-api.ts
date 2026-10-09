import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { AdjuntosClinicosService } from '../../../api/generated/api/adjuntos-clinicos.service';
import { HistoriaClinicaService } from '../../../api/generated/api/historia-clinica.service';
import { TimelineClinicoService } from '../../../api/generated/api/timeline-clinico.service';
import { AdjuntoClinicoPageResponse } from '../../../api/generated/model/adjunto-clinico-page-response';
import { HistoriaClinicaResponse } from '../../../api/generated/model/historia-clinica-response';
import { TimelineResponse } from '../../../api/generated/model/timeline-response';

/** Cantidad de eventos por pagina del timeline. */
export const LIMITE_TIMELINE = 20;

/**
 * Unico punto del timeline que toca el cliente generado.
 *
 * <p>Solo lectura: no hay ninguna operacion de escritura clinica. El orden y el cursor son del
 * backend; esta fachada no reordena nada.
 */
@Injectable({ providedIn: 'root' })
export class TimelineApi {
  private readonly historias = inject(HistoriaClinicaService);
  private readonly timeline = inject(TimelineClinicoService);
  private readonly adjuntos = inject(AdjuntosClinicosService);

  /** Abre la HC de la persona o devuelve la existente (idempotente). */
  abrirHistoria(personaId: number): Observable<HistoriaClinicaResponse> {
    return this.historias.abrirOObtenerHistoriaClinica({ personaId });
  }

  /** Una pagina del timeline; `cursor` es el opaco que devolvio la pagina anterior. */
  verTimeline(historiaClinicaId: number, cursor?: string): Observable<TimelineResponse> {
    return this.timeline.verTimelineClinico({ historiaClinicaId, cursor, limite: LIMITE_TIMELINE });
  }

  /** Adjuntos de la HC, opcionalmente de una sola entrada. */
  listarAdjuntos(
    historiaClinicaId: number,
    entradaClinicaId?: number,
  ): Observable<AdjuntoClinicoPageResponse> {
    return this.adjuntos.listarAdjuntosClinicos({ historiaClinicaId, entradaClinicaId });
  }

  /** Binario del adjunto. */
  descargar(historiaClinicaId: number, adjuntoId: number): Observable<Blob> {
    return this.adjuntos.descargarAdjuntoClinico({ historiaClinicaId, adjuntoId }, 'body', false, {
      httpHeaderAccept: 'application/octet-stream',
    }) as Observable<Blob>;
  }
}
