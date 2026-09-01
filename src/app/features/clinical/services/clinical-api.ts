import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CerrarSesion } from '../../../api/generated/model/cerrar-sesion';
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
 * <p><b>No hay nada economico.</b> Cerrar una atencion no cobra y no crea ninguna obligacion
 * (DP-06): la deuda se deriva despues, del lado del backend, leyendo las sesiones cerradas. Un
 * metodo de cobro colgado de esta fachada sugeriria que el cierre depende del pago, que es
 * exactamente la confusion que la regla maestra 5 existe para evitar.
 *
 * <p><b>Tampoco hay enmendar una sesion cerrada.</b> Corregirla exige actor y motivo propios y eso
 * es AKINE-06.06, fuera de alcance. El contrato no publica el endpoint, y un boton sin endpoint es
 * peor que la ausencia del boton.
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

  /**
   * Cierra la atencion y le asigna su correlativo por historia clinica (AKINE-06.05).
   *
   * <p><b>Es idempotente</b>, igual que {@link iniciar}: cerrar dos veces devuelve el mismo
   * resultado con el mismo `numeroSesion` y no renumera. Por eso la pantalla no tiene ninguna
   * guarda contra el segundo click ni ninguna rama para "ya estaba cerrada": apretar dos veces es
   * el caso normal, y renumerar una sesion cerrada seria reescribir historia clinica.
   *
   * <p>La respuesta es la sesion completa —con `numeroSesion`, `cerradaEn` y el `cierre`—, asi que
   * la pantalla no necesita releer para pasar a modo lectura.
   */
  cerrar(consultorioId: number, sesionId: number, cierre: CerrarSesion): Observable<Sesion> {
    return this.sesiones.cerrar({ consultorioId, sesionId, cerrarSesion: cierre });
  }
}
