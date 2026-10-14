import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { DatosAdministrativosDeHistoriaResponse } from '../../../api/generated/model/datos-administrativos-de-historia-response';
import { HabilitacionesResponse } from '../../../api/generated/model/habilitaciones-response';
import { HistoriaClinicaService } from '../../../api/generated/api/historia-clinica.service';
import { OfertaResponse } from '../../../api/generated/model/oferta-response';
import { ServiciosYOfertasService } from '../../../api/generated/api/servicios-y-ofertas.service';

/**
 * Los datos administrativos de la historia clinica de una persona, para el Paciente 360.
 *
 * <p>Matriz §32, "Ver Historia Clinica" del ADMINISTRATIVO: <b>Limitado</b>, solo metadatos. Si
 * hay historia, desde cuando, los casos —numero, estado, oferta, fechas— y el equipo vigente.
 * <b>Nunca contenido clinico</b>: ni resumen, ni antecedentes, ni diagnostico, ni motivo de
 * cierre. Por eso alcanza `paciente:read`, no pide justificacion y no se audita como acceso
 * clinico.
 *
 * <p>Vive en `person` y no en `clinical` a proposito: es la ficha de mostrador la que la muestra,
 * y un feature no importa de otro (AGENT.md 4.4). Lo que se comparte es el cliente generado.
 *
 * <p>Los nombres de oferta y de profesional no viajan en la respuesta: se resuelven con las
 * lecturas de la sede, y si alguna falla la pantalla muestra el identificador en vez de nada.
 */
@Injectable({ providedIn: 'root' })
export class HistoriaAdministrativaApi {
  private readonly historia = inject(HistoriaClinicaService);
  private readonly ofertas = inject(ServiciosYOfertasService);

  datos(personaId: number): Observable<DatosAdministrativosDeHistoriaResponse> {
    return this.historia.verDatosAdministrativosDeHistoriaClinica({ personaId });
  }

  /** Todas las ofertas de la sede, vigentes o no: un caso viejo puede ser de una dada de baja. */
  ofertasDeLaSede(consultorioId: number): Observable<OfertaResponse[]> {
    return this.ofertas.listOfertas({ consultorioId, estado: 'TODOS' });
  }

  /** Quien esta habilitado a prestar una oferta: de ahi salen los nombres del equipo. */
  profesionalesDeOferta(
    consultorioId: number,
    ofertaId: number,
  ): Observable<HabilitacionesResponse> {
    return this.ofertas.getHabilitaciones({ consultorioId, ofertaId });
  }
}
