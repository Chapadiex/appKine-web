import { HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { AdjuntosClinicosService } from '../../../api/generated/api/adjuntos-clinicos.service';
import { CasosClinicosService } from '../../../api/generated/api/casos-clinicos.service';
import { EntradasClinicasService } from '../../../api/generated/api/entradas-clinicas.service';
import { HistoriaClinicaService } from '../../../api/generated/api/historia-clinica.service';
import { TimelineClinicoService } from '../../../api/generated/api/timeline-clinico.service';
import {
  AdjuntoClinicoResponse,
  AdjuntoClinicoResponseCategoriaEnum,
} from '../../../api/generated/model/adjunto-clinico-response';
import { CasoClinico } from '../../../api/generated/model/caso-clinico';
import { EntradaClinicaResponse } from '../../../api/generated/model/entrada-clinica-response';
import { EntradaClinicaVersionResponse } from '../../../api/generated/model/entrada-clinica-version-response';
import { HistoriaClinicaResponse } from '../../../api/generated/model/historia-clinica-response';
import { RegistrarEntradaClinicaRequestTipoEnum } from '../../../api/generated/model/registrar-entrada-clinica-request';
import { TimelineResponse } from '../../../api/generated/model/timeline-response';

/**
 * Motivo declarado del acceso clinico (DP-03), o `null` si quien mira tiene relacion asistencial.
 *
 * <p>Viaja en CADA pedido de la visita, no solo en el primero: el backend audita cada lectura por
 * separado, y una lectura sin motivo de alguien sin relacion es un 403 aunque la anterior lo haya
 * llevado.
 */
export type Justificacion = string | null;

/** Tamano de pagina pedido. El servidor lo acota; pedir mas no trae mas. */
const TAMANO_DE_PAGINA = 20;

/**
 * Unico punto de la Historia Clinica que toca el cliente generado (D-a, RF-M09-001/003, RF-M25).
 *
 * <p>Mismo criterio que {@link ClinicalApi}: las pantallas dependen de esta clase y de los tipos
 * del contrato, nunca del servicio generado. La razon extra aca es el motivo de acceso: tenerlo en
 * un solo lugar hace imposible que una llamada nueva se olvide de mandarlo.
 */
@Injectable({ providedIn: 'root' })
export class HistoriaClinicaApi {
  private readonly historias = inject(HistoriaClinicaService);
  private readonly timeline = inject(TimelineClinicoService);
  private readonly entradas = inject(EntradasClinicasService);
  private readonly adjuntos = inject(AdjuntosClinicosService);
  private readonly casos = inject(CasosClinicosService);

  /** La historia de la persona. 404 si no tiene: leer no la abre. */
  ver(personaId: number, justificacion: Justificacion): Observable<HistoriaClinicaResponse> {
    return this.historias.verHistoriaClinica({ personaId, ...motivo(justificacion) });
  }

  /** Abre la historia o devuelve la que ya tenia. Idempotente: un doble click no duplica nada. */
  abrir(personaId: number, justificacion: Justificacion): Observable<HistoriaClinicaResponse> {
    return this.historias.abrirOObtenerHistoriaClinica({ personaId, ...motivo(justificacion) });
  }

  /**
   * Una pagina del timeline. `cursor` es el `proximoCursor` de la pagina anterior y nada mas: es
   * opaco, y uno inventado es 400 `cursor-invalido`, nunca "la primera pagina".
   */
  paginaDelTimeline(
    historiaClinicaId: number,
    cursor: string | null,
    casoId: number | null,
    justificacion: Justificacion,
  ): Observable<TimelineResponse> {
    return this.timeline.verTimelineClinico({
      historiaClinicaId,
      limite: TAMANO_DE_PAGINA,
      ...(cursor === null ? {} : { cursor }),
      ...(casoId === null ? {} : { casoId }),
      ...motivo(justificacion),
    });
  }

  /** Casos de la historia, activos y cerrados: el filtro tiene que poder mirar el pasado. */
  casosDe(historiaClinicaId: number, justificacion: Justificacion): Observable<CasoClinico[]> {
    return this.casos.listarCasosClinicos({
      historiaClinicaId,
      soloActivos: false,
      ...motivo(justificacion),
    });
  }

  entrada(
    entradaClinicaId: number,
    justificacion: Justificacion,
  ): Observable<EntradaClinicaResponse> {
    return this.entradas.verEntradaClinica({ entradaClinicaId, ...motivo(justificacion) });
  }

  versiones(
    entradaClinicaId: number,
    justificacion: Justificacion,
  ): Observable<EntradaClinicaVersionResponse[]> {
    return this.entradas.verVersionesDeEntradaClinica({
      entradaClinicaId,
      ...motivo(justificacion),
    });
  }

  registrarEntrada(
    historiaClinicaId: number,
    tipo: RegistrarEntradaClinicaRequestTipoEnum,
    cuerpo: string,
    justificacion: Justificacion,
  ): Observable<EntradaClinicaResponse> {
    return this.entradas.registrarEntradaClinica({
      historiaClinicaId,
      registrarEntradaClinicaRequest: { tipo, cuerpo },
      ...motivo(justificacion),
    });
  }

  /**
   * Enmienda: crea una version nueva y deja la anterior consultable (RN-M09-004).
   *
   * <p>`expectedVersion` es la de la entrada leida: si otra persona enmendo en el medio, 409 en
   * vez de pisar su correccion.
   */
  enmendar(
    entradaClinicaId: number,
    cuerpo: string,
    motivoDeEnmienda: string,
    expectedVersion: number,
    justificacion: Justificacion,
  ): Observable<EntradaClinicaResponse> {
    return this.entradas.enmendarEntradaClinica({
      entradaClinicaId,
      enmendarEntradaClinicaRequest: { cuerpo, motivo: motivoDeEnmienda, expectedVersion },
      ...motivo(justificacion),
    });
  }

  /**
   * El archivo como binario, con la respuesta entera: el nombre viene en `Content-Disposition` y
   * el tipo en `Content-Type`, porque el evento del timeline no los trae a proposito. El error, si lo hay, tambien llega como Blob y el interceptor lo
   * convierte en problem detail.
   */
  descargar(
    historiaClinicaId: number,
    adjuntoId: number,
    justificacion: Justificacion,
  ): Observable<HttpResponse<Blob>> {
    return this.adjuntos.descargarAdjuntoClinico(
      { historiaClinicaId, adjuntoId, ...motivo(justificacion) },
      'response',
      false,
      { httpHeaderAccept: 'application/octet-stream' },
    ) as Observable<HttpResponse<Blob>>;
  }

  subirAdjunto(
    historiaClinicaId: number,
    categoria: AdjuntoClinicoResponseCategoriaEnum,
    archivo: File,
    titulo: string,
    justificacion: Justificacion,
  ): Observable<AdjuntoClinicoResponse> {
    return this.adjuntos.subirAdjuntoClinico({
      historiaClinicaId,
      categoria,
      archivo,
      ...(titulo === '' ? {} : { titulo }),
      ...motivo(justificacion),
    });
  }
}

/** El header va solo si hay motivo: mandarlo vacio no es "sin motivo", es un motivo invalido. */
function motivo(justificacion: Justificacion): { xJustificacionAcceso?: string } {
  return justificacion === null ? {} : { xJustificacionAcceso: justificacion };
}
