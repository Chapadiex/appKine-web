import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of } from 'rxjs';

import { AsistenciaDeClasesService } from '../../../api/generated/api/asistencia-de-clases.service';
import { AtencionClinicaGrupalService } from '../../../api/generated/api/atencion-clinica-grupal.service';
import { DerivacionClinicaDeParticipantesService } from '../../../api/generated/api/derivacion-clinica-de-participantes.service';
import { AtencionDeParticipante } from '../../../api/generated/model/atencion-de-participante';
import { AtencionGrupal } from '../../../api/generated/model/atencion-grupal';
import { DerivacionDeParticipante } from '../../../api/generated/model/derivacion-de-participante';
import { DerivacionesDeParticipante } from '../../../api/generated/model/derivaciones-de-participante';
import { DetalleOperativoDeClase } from '../../../api/generated/model/detalle-operativo-de-clase';
import { IniciarAtencionGrupalItem } from '../../../api/generated/model/iniciar-atencion-grupal-item';
import { ResultadoDeAtencionGrupal } from '../../../api/generated/model/resultado-de-atencion-grupal';

/** Tope de participantes por pagina del detalle operativo que acepta el backend. */
const PARTICIPANTES_POR_PAGINA = 100;

/** Motivo de acceso declarado (DP-03), o `null` si no se declaro ninguno. */
export type MotivoDeAcceso = string | null;

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
  private readonly asistencia = inject(AsistenciaDeClasesService);
  private readonly derivaciones = inject(DerivacionClinicaDeParticipantesService);

  /**
   * El panel: quien estuvo y que atenciones tiene, <b>sin contenido clinico</b>. Exige
   * `sesion:register`. En una clase cuya oferta no genera registro clinico vuelve `clinica=false`.
   */
  panel(consultorioId: number, claseId: number): Observable<AtencionGrupal> {
    return this.atencion.verAtencionGrupal({ consultorioId, claseId });
  }

  /**
   * Titulo, horario y nombres de los participantes. El panel no nombra a nadie —solo ids—, y los
   * nombres salen del detalle operativo de la asistencia (`inscripcion:read`).
   *
   * <p><b>Nunca falla</b>: sin el detalle el panel se sigue pudiendo usar, con el numero de
   * inscripcion en lugar del nombre.
   */
  clase(consultorioId: number, claseId: number): Observable<DetalleOperativoDeClase | null> {
    return this.asistencia
      .detalleOperativo({ consultorioId, claseId, page: 0, size: PARTICIPANTES_POR_PAGINA })
      .pipe(catchError(() => of(null)));
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
