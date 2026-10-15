import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CasosClinicosService } from '../../../api/generated/api/casos-clinicos.service';
import { AbrirCasoClinicoRequest } from '../../../api/generated/model/abrir-caso-clinico-request';
import { CasoClinico } from '../../../api/generated/model/caso-clinico';
import { CasoEvento } from '../../../api/generated/model/caso-evento';
import { EditarCasoClinicoRequest } from '../../../api/generated/model/editar-caso-clinico-request';
import { IntegranteDelEquipo } from '../../../api/generated/model/integrante-del-equipo';
import { Justificacion, motivoDeAcceso } from '../services/historia-clinica-api';

/**
 * Unico punto de los casos clinicos que toca el cliente generado (D-b, M10).
 *
 * <p>Cada metodo recibe el motivo de acceso de la visita (DP-03): un caso es contenido clinico
 * —diagnostico, objetivo, motivo de cierre— y su lectura se audita igual que la de la historia.
 * Tenerlo en la firma hace imposible que una llamada nueva se olvide de mandarlo.
 */
@Injectable({ providedIn: 'root' })
export class CasosApi {
  private readonly casos = inject(CasosClinicosService);

  /** Activos y cerrados, mas recientes primero: un caso cerrado se sigue leyendo entero. */
  listar(historiaClinicaId: number, justificacion: Justificacion): Observable<CasoClinico[]> {
    return this.casos.listarCasosClinicos({
      historiaClinicaId,
      soloActivos: false,
      ...motivoDeAcceso(justificacion),
    });
  }

  abrir(
    historiaClinicaId: number,
    abrirCasoClinicoRequest: AbrirCasoClinicoRequest,
    justificacion: Justificacion,
  ): Observable<CasoClinico> {
    return this.casos.abrirCasoClinico({
      historiaClinicaId,
      abrirCasoClinicoRequest,
      ...motivoDeAcceso(justificacion),
    });
  }

  ver(casoClinicoId: number, justificacion: Justificacion): Observable<CasoClinico> {
    return this.casos.verCasoClinico({ casoClinicoId, ...motivoDeAcceso(justificacion) });
  }

  eventos(casoClinicoId: number, justificacion: Justificacion): Observable<CasoEvento[]> {
    return this.casos.verEventosDeCasoClinico({
      casoClinicoId,
      ...motivoDeAcceso(justificacion),
    });
  }

  editar(
    casoClinicoId: number,
    editarCasoClinicoRequest: EditarCasoClinicoRequest,
    justificacion: Justificacion,
  ): Observable<CasoClinico> {
    return this.casos.editarCasoClinico({
      casoClinicoId,
      editarCasoClinicoRequest,
      ...motivoDeAcceso(justificacion),
    });
  }

  /** El motivo es obligatorio: queda en el historial del caso (RF-M10-005). */
  cerrar(
    casoClinicoId: number,
    motivo: string,
    expectedVersion: number,
    justificacion: Justificacion,
  ): Observable<CasoClinico> {
    return this.casos.cerrarCasoClinico({
      casoClinicoId,
      cerrarCasoClinicoRequest: { motivo, expectedVersion },
      ...motivoDeAcceso(justificacion),
    });
  }

  /** Vuelve a ACTIVO y deja el cierre anterior en el historial (RF-M10-006). */
  reabrir(
    casoClinicoId: number,
    motivo: string,
    expectedVersion: number,
    justificacion: Justificacion,
  ): Observable<CasoClinico> {
    return this.casos.reabrirCasoClinico({
      casoClinicoId,
      reabrirCasoClinicoRequest: { motivo, expectedVersion },
      ...motivoDeAcceso(justificacion),
    });
  }

  /**
   * Reemplazo completo del equipo. Desde `appKine-api` #109 la respuesta trae la version NUEVA
   * (`leida + 1`): un segundo cambio encadenado sobre esa respuesta pasa, y uno concurrente desde
   * otra pestaña recibe `concurrent-modification`.
   */
  cambiarEquipo(
    casoClinicoId: number,
    integrantes: IntegranteDelEquipo[],
    expectedVersion: number,
    justificacion: Justificacion,
  ): Observable<CasoClinico> {
    return this.casos.cambiarEquipoDeCasoClinico({
      casoClinicoId,
      equipoDelCasoRequest: { integrantes, expectedVersion },
      ...motivoDeAcceso(justificacion),
    });
  }
}
