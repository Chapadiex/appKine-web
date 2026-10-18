import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';

import { AtencionClinicaGrupalService } from '../../../api/generated/api/atencion-clinica-grupal.service';
import { ClasesService } from '../../../api/generated/api/clases.service';
import { DerivacionClinicaDeParticipantesService } from '../../../api/generated/api/derivacion-clinica-de-participantes.service';
import { HistoriaClinicaService } from '../../../api/generated/api/historia-clinica.service';
import { AtencionDeParticipante } from '../../../api/generated/model/atencion-de-participante';
import { AtencionGrupal } from '../../../api/generated/model/atencion-grupal';
import {
  CasoAdministrativoResponse,
  CasoAdministrativoResponseEstadoEnum,
} from '../../../api/generated/model/caso-administrativo-response';
import { Clase } from '../../../api/generated/model/clase';
import { DerivacionDeParticipante } from '../../../api/generated/model/derivacion-de-participante';
import { DerivacionesDeParticipante } from '../../../api/generated/model/derivaciones-de-participante';
import { DerivarParticipante } from '../../../api/generated/model/derivar-participante';
import { ElegibilidadClinicaDeParticipante } from '../../../api/generated/model/elegibilidad-clinica-de-participante';
import { IniciarAtencionGrupalItem } from '../../../api/generated/model/iniciar-atencion-grupal-item';
import { ResultadoDeAtencionGrupal } from '../../../api/generated/model/resultado-de-atencion-grupal';

/** Motivo de acceso declarado (DP-03), o `null` si no se declaro ninguno. */
export type MotivoDeAcceso = string | null;

/** Los casos a los que se puede derivar: solo los ACTIVOS, con lo administrativo y nada clinico. */
export interface CasosParaDerivar {
  readonly tieneHistoriaClinica: boolean;
  readonly casos: readonly CasoAdministrativoResponse[];
}

/**
 * Fachada de la atencion clinica grupal (M14/M28, AKINE-08.05) sobre el cliente generado.
 *
 * <p><b>Una atencion grupal es una Sesion por participante y por Caso</b>, abierta desde la
 * derivacion clinica de 08.04. Lo que esta fachada hace es abrirlas; todo lo demas —evaluacion,
 * tratamientos, cierre, enmienda— va por {@link ClinicalApi}, como cualquier otra Sesion. No hay
 * cierre en lote a proposito: cada cierre lleva lo de su paciente (RF-M14-013).
 *
 * <p>Vive en `clinical` y no en `activity` porque lo que abre es historia clinica: la pantalla que
 * la usa termina en la atencion de cada participante.
 */
@Injectable({ providedIn: 'root' })
export class AtencionGrupalApi {
  private readonly atencion = inject(AtencionClinicaGrupalService);
  private readonly clases = inject(ClasesService);
  private readonly derivaciones = inject(DerivacionClinicaDeParticipantesService);
  private readonly historias = inject(HistoriaClinicaService);

  /**
   * El panel: quien estuvo y que atenciones tiene, <b>sin contenido clinico</b>. Exige
   * `sesion:register`. En una clase cuya oferta no genera registro clinico vuelve `clinica=false`.
   */
  panel(consultorioId: number, claseId: number): Observable<AtencionGrupal> {
    return this.atencion.verAtencionGrupal({ consultorioId, claseId });
  }

  /**
   * Titulo y horario de la clase (`clase:read`). Los nombres de los participantes ya vienen en el
   * panel (contrato 0.118.0), asi que no hace falta el detalle operativo de la asistencia, que
   * traia una pagina entera de personas solo para nombrarlas.
   *
   * <p><b>Nunca falla</b>: sin la clase el panel se sigue pudiendo usar, con "Clase N" de titulo.
   */
  clase(consultorioId: number, claseId: number): Observable<Clase | null> {
    return this.clases.verClase({ consultorioId, claseId }).pipe(catchError(() => of(null)));
  }

  /**
   * Abre la atencion de un participante, o devuelve la que ya tenia (`yaExistia`). Con una sola
   * derivacion vigente no hace falta nombrarla; con varias, si: si falta, 409 `derivacion-ambigua`.
   */
  iniciar(
    consultorioId: number,
    claseId: number,
    inscripcionId: number,
    derivacionId: number | null,
    motivo: MotivoDeAcceso,
  ): Observable<AtencionDeParticipante> {
    return this.atencion.iniciarAtencionDeParticipante({
      consultorioId,
      claseId,
      inscripcionId,
      xJustificacionAcceso: motivo ?? undefined,
      iniciarAtencionDeParticipante: derivacionId === null ? {} : { derivacionId },
    });
  }

  /** Abre varias. Responde 200 aunque fallen algunas: cada item trae su `problemType`. */
  iniciarLote(
    consultorioId: number,
    claseId: number,
    items: IniciarAtencionGrupalItem[],
    motivo: MotivoDeAcceso,
  ): Observable<ResultadoDeAtencionGrupal> {
    return this.atencion.iniciarAtencionGrupal({
      consultorioId,
      claseId,
      iniciarAtencionGrupal: { items },
      xJustificacionAcceso: motivo ?? undefined,
    });
  }

  /**
   * Si el participante se puede derivar y por que no (AKINE-08.04). Veredicto <b>grupal</b>: no
   * lee nada clinico, no se audita y no pide motivo. Exige `inscripcion:read`.
   */
  elegibilidad(
    consultorioId: number,
    claseId: number,
    inscripcionId: number,
  ): Observable<ElegibilidadClinicaDeParticipante> {
    return this.derivaciones.verElegibilidadClinicaDeParticipante({
      consultorioId,
      claseId,
      inscripcionId,
    });
  }

  /**
   * Los casos ACTIVOS de la persona, por los <b>datos administrativos</b> de su historia
   * (`paciente:read`): numero, oferta y fecha de apertura, sin diagnostico ni objetivo. Elegir el
   * Caso de una derivacion no necesita leer contenido clinico, y por eso no pide motivo ni se
   * audita como acceso clinico. Una persona sin perfil de paciente es 404.
   */
  casosParaDerivar(personaId: number): Observable<CasosParaDerivar> {
    return this.historias.verDatosAdministrativosDeHistoriaClinica({ personaId }).pipe(
      map((datos) => ({
        tieneHistoriaClinica: datos.tieneHistoriaClinica === true,
        casos: (datos.casos ?? []).filter(
          (caso) => caso.estado === CasoAdministrativoResponseEstadoEnum.ACTIVO,
        ),
      })),
    );
  }

  /**
   * Deriva al participante a un Caso (RF-M28-008). <b>Derivar no es atender</b>: no crea Sesion,
   * no consume autorizacion y no devenga. Idempotente por destino: repetir al mismo Caso devuelve
   * la existente con `yaExistia`. Exige `hc:write` con relacion asistencial o motivo declarado.
   */
  derivar(
    consultorioId: number,
    claseId: number,
    inscripcionId: number,
    derivacion: DerivarParticipante,
    motivo: MotivoDeAcceso,
  ): Observable<DerivacionDeParticipante> {
    return this.derivaciones.derivarParticipante({
      consultorioId,
      claseId,
      inscripcionId,
      derivarParticipante: derivacion,
      xJustificacionAcceso: motivo ?? undefined,
    });
  }

  /** Derivaciones del participante. Es lectura clinica: se audita y puede pedir motivo. */
  derivacionesDe(
    consultorioId: number,
    claseId: number,
    inscripcionId: number,
    motivo: MotivoDeAcceso,
  ): Observable<DerivacionesDeParticipante> {
    return this.derivaciones.listarDerivacionesDeParticipante({
      consultorioId,
      claseId,
      inscripcionId,
      xJustificacionAcceso: motivo ?? undefined,
    });
  }

  /**
   * Revierte una derivacion. Con una atencion abierta desde ella es 409 `derivacion-con-sesion`:
   * la Sesion no se borra y la derivacion queda fija.
   */
  revertir(
    consultorioId: number,
    claseId: number,
    inscripcionId: number,
    derivacionId: number,
    motivoReversion: string,
    motivo: MotivoDeAcceso,
  ): Observable<DerivacionDeParticipante> {
    return this.derivaciones.revertirDerivacionDeParticipante({
      consultorioId,
      claseId,
      inscripcionId,
      derivacionId,
      revertirDerivacion: { motivo: motivoReversion },
      xJustificacionAcceso: motivo ?? undefined,
    });
  }
}
