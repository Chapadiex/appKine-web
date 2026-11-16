import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { SugerenciasDeEvolucionService } from '../../../api/generated/api/sugerencias-de-evolucion.service';
import { SugerenciaDeEvolucionGeneracionResponse } from '../../../api/generated/model/sugerencia-de-evolucion-generacion-response';
import { SugerenciaDeEvolucionPageResponse } from '../../../api/generated/model/sugerencia-de-evolucion-page-response';
import { SugerenciaDeEvolucionResponse } from '../../../api/generated/model/sugerencia-de-evolucion-response';
import { SugerenciaDeEvolucionRespuestaRequest } from '../../../api/generated/model/sugerencia-de-evolucion-respuesta-request';
import { Justificacion, motivoDeAcceso } from '../services/historia-clinica-api';

/** Cuantas sugerencias trae el historial: el maximo del contrato, una sola pagina. */
const TAMANO_DEL_HISTORIAL = 100;

/**
 * Unico punto de las sugerencias de evolucion que toca el cliente generado (M31 fase 2, contrato
 * 0.171.0). Todo viaja con el motivo de la visita, igual que la evolucion: son lecturas clinicas.
 */
@Injectable({ providedIn: 'root' })
export class SugerenciasApi {
  private readonly sugerencias = inject(SugerenciasDeEvolucionService);

  historial(
    consultorioId: number,
    casoId: number,
    justificacion: Justificacion,
  ): Observable<SugerenciaDeEvolucionPageResponse> {
    return this.sugerencias.listarSugerenciasDeEvolucion({
      consultorioId,
      casoId,
      page: 0,
      size: TAMANO_DEL_HISTORIAL,
      ...motivoDeAcceso(justificacion),
    });
  }

  generar(
    consultorioId: number,
    casoId: number,
    justificacion: Justificacion,
  ): Observable<SugerenciaDeEvolucionGeneracionResponse> {
    return this.sugerencias.generarSugerenciasDeEvolucion({
      consultorioId,
      casoId,
      ...motivoDeAcceso(justificacion),
    });
  }

  responder(
    consultorioId: number,
    casoId: number,
    sugerenciaId: number,
    respuesta: SugerenciaDeEvolucionRespuestaRequest,
    justificacion: Justificacion,
  ): Observable<SugerenciaDeEvolucionResponse> {
    return this.sugerencias.responderSugerenciaDeEvolucion({
      consultorioId,
      casoId,
      sugerenciaId,
      sugerenciaDeEvolucionRespuestaRequest: respuesta,
      ...motivoDeAcceso(justificacion),
    });
  }
}
