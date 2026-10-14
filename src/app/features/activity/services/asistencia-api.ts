import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { AgendaUnificadaService } from '../../../api/generated/api/agenda-unificada.service';
import { AsistenciaDeClasesService } from '../../../api/generated/api/asistencia-de-clases.service';
import { AgendaUnificada } from '../../../api/generated/model/agenda-unificada';
import { Clase } from '../../../api/generated/model/clase';
import { DetalleOperativoDeClase } from '../../../api/generated/model/detalle-operativo-de-clase';
import { EventoDeAsistencia } from '../../../api/generated/model/evento-de-asistencia';
import { RegistrarAsistencia } from '../../../api/generated/model/registrar-asistencia';
import { ResultadoDeCierreDeClase } from '../../../api/generated/model/resultado-de-cierre-de-clase';
import { ResultadoDeLoteDeAsistencia } from '../../../api/generated/model/resultado-de-lote-de-asistencia';

/** Tope de participantes por pagina del detalle operativo que acepta el backend. */
export const PARTICIPANTES_POR_PAGINA = 100;

/**
 * Fachada de la asistencia de clases (M28/M13, AKINE-08.03) sobre el cliente generado
 * (AGENT.md §4.5: las features no usan `HttpClient`).
 */
@Injectable({ providedIn: 'root' })
export class AsistenciaApi {
  private readonly asistencia = inject(AsistenciaDeClasesService);
  private readonly agenda = inject(AgendaUnificadaService);

  /** Las clases del dia de la sede, con la zona que trae la agenda unificada. */
  clasesDelDia(consultorioId: number, fecha: string): Observable<AgendaUnificada> {
    return this.agenda.delDiaAgendaUnificada({ consultorioId, fecha }).pipe(
      map((agenda) => ({
        ...agenda,
        eventos: (agenda.eventos ?? []).filter((evento) => evento.tipo === 'CLASE'),
      })),
    );
  }

  detalle(consultorioId: number, claseId: number, page = 0): Observable<DetalleOperativoDeClase> {
    return this.asistencia.detalleOperativo({
      consultorioId,
      claseId,
      page,
      size: PARTICIPANTES_POR_PAGINA,
    });
  }

  iniciar(consultorioId: number, claseId: number): Observable<Clase> {
    return this.asistencia.iniciarAsistencia({ consultorioId, claseId });
  }

  cerrar(consultorioId: number, claseId: number): Observable<ResultadoDeCierreDeClase> {
    return this.asistencia.cerrarAsistencia({ consultorioId, claseId });
  }

  registrarLote(
    consultorioId: number,
    claseId: number,
    items: RegistrarAsistencia[],
  ): Observable<ResultadoDeLoteDeAsistencia> {
    return this.asistencia.registrarLote({
      consultorioId,
      claseId,
      registrarAsistenciaLote: { items },
    });
  }

  historial(
    consultorioId: number,
    claseId: number,
    asistenciaId: number,
  ): Observable<EventoDeAsistencia[]> {
    return this.asistencia.historialAsistencia({ consultorioId, claseId, asistenciaId });
  }
}
