import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';

import { ServiciosYOfertasService } from '../../../api/generated/api/servicios-y-ofertas.service';
import { OfertaResponse } from '../../../api/generated/model/oferta-response';
import { ProfesionalHabilitado } from '../../../api/generated/model/profesional-habilitado';

/**
 * Las lecturas de la sede que los casos y los planes necesitan para no pedir identificadores a
 * mano: que ofertas hay y quien esta habilitado a prestarlas (D-b, D-c).
 *
 * <p>No es contenido clinico: no lleva motivo de acceso y no se audita. Son <b>accesorias</b>: si
 * fallan, la pantalla muestra el identificador en vez del nombre y el backend sigue siendo quien
 * valida (`oferta-no-vigente`, `oferta-no-habilitada`).
 */
@Injectable({ providedIn: 'root' })
export class SedeClinicaApi {
  private readonly ofertas = inject(ServiciosYOfertasService);

  /** Todas las ofertas de la sede, vigentes o no: un caso o un plan viejo puede nombrar una baja. */
  ofertas$(consultorioId: number): Observable<OfertaResponse[]> {
    return this.ofertas
      .listOfertas({ consultorioId, estado: 'TODOS' })
      .pipe(catchError(() => of([])));
  }

  /** Quien puede prestar la oferta: de ahi salen los candidatos y los nombres del equipo. */
  profesionales$(consultorioId: number, ofertaId: number): Observable<ProfesionalHabilitado[]> {
    return this.ofertas.getHabilitaciones({ consultorioId, ofertaId }).pipe(
      map((r) => r.profesionales ?? []),
      catchError(() => of([])),
    );
  }
}

/** Lo que se puede elegir hoy para abrir un caso o planificar: activa y vigente en la sede. */
export function ofertaElegible(oferta: OfertaResponse): boolean {
  return oferta.estado === 'ACTIVO' && oferta.vigenteHoy !== false;
}
