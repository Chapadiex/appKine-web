import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { GuardarEvaluacion } from '../../../api/generated/model/guardar-evaluacion';
import { Sesion } from '../../../api/generated/model/sesion';
import { SesionesService } from '../../../api/generated/api/sesiones.service';

/**
 * Unico punto de la feature `clinical` que toca el cliente generado (M14, AKINE-06.01 y 06.02).
 *
 * <p>Mismo criterio que `SchedulingApi` y `PersonApi`: la pantalla depende de esta clase y de los
 * tipos del contrato, nunca del servicio generado directo.
 *
 * <h2>Lo que esta fachada NO tiene</h2>
 *
 * <p><b>No hay cerrar la sesion.</b> No es una omision: AKINE-06.05 todavia no existe y el
 * contrato no publica el endpoint. Un boton sin endpoint es peor que la ausencia del boton.
 *
 * <p>Tampoco hay Historia Clinica: la sesion trae su `historiaClinicaId`, pero no hay ninguna
 * operacion HTTP que la lea.
 */
@Injectable({ providedIn: 'root' })
export class ClinicalApi {
  private readonly sesiones = inject(SesionesService);

  /**
   * Abre la atencion del turno, o devuelve la que ya estaba abierta.
   *
   * <p><b>Es idempotente a proposito</b> (RN-M14-001: un turno produce como mucho una sesion).
   * Abrir dos veces —doble click, recarga de la pantalla, volver desde otra pestaña— es el caso
   * normal y no hay nada que preguntarle al usuario. Por eso la pantalla monta sobre el turno y
   * no sobre la sesion: recargar la URL vuelve a la misma atencion.
   */
  iniciar(consultorioId: number, turnoId: number): Observable<Sesion> {
    return this.sesiones.iniciar({ consultorioId, turnoId });
  }

  /**
   * Relee la sesion.
   *
   * <p>Es la accion que resuelve el conflicto de version: trae la `version` fresca y lo que
   * guardo la otra pestaña, sin tocar nada de lo que hay escrito en pantalla.
   */
  ver(consultorioId: number, sesionId: number): Observable<Sesion> {
    return this.sesiones.ver({ consultorioId, sesionId });
  }

  /**
   * Autosave del contenido libre.
   *
   * <p>`version` es la que se leyo. Sin ella dos pestañas del mismo profesional se pisan en
   * silencio, que es exactamente la perdida de datos que esta etapa existe para evitar.
   */
  guardarBorrador(
    consultorioId: number,
    sesionId: number,
    contenido: string,
    version: number,
  ): Observable<Sesion> {
    return this.sesiones.guardarBorrador({
      consultorioId,
      sesionId,
      guardarBorrador: { contenido, version },
    });
  }

  /** Evaluacion tipada. Mismo control de version que el borrador. */
  evaluar(
    consultorioId: number,
    sesionId: number,
    evaluacion: GuardarEvaluacion,
  ): Observable<Sesion> {
    return this.sesiones.evaluar({ consultorioId, sesionId, guardarEvaluacion: evaluacion });
  }
}
