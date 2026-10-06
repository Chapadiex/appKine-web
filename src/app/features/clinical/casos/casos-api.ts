import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { CasoClinico } from '../../../api/generated/model/caso-clinico';
import { CasoEvento } from '../../../api/generated/model/caso-evento';
import { AbrirCasoClinicoRequest } from '../../../api/generated/model/abrir-caso-clinico-request';
import { EditarCasoClinicoRequest } from '../../../api/generated/model/editar-caso-clinico-request';
import { CerrarCasoClinicoRequest } from '../../../api/generated/model/cerrar-caso-clinico-request';
import { ReabrirCasoClinicoRequest } from '../../../api/generated/model/reabrir-caso-clinico-request';
import { EquipoDelCasoRequest } from '../../../api/generated/model/equipo-del-caso-request';
import { CasosClinicosService } from '../../../api/generated/api/casos-clinicos.service';

/**
 * Unico punto de la feature `clinical` que toca el cliente generado para casos clinicos.
 *
 * <p>Mismo criterio que `ClinicalApi`: la pantalla depende de esta clase y de los tipos del contrato,
 * nunca del servicio generado directo.
 */
@Injectable({ providedIn: 'root' })
export class CasosApi {
  private readonly casosClinicosService = inject(CasosClinicosService);

  listar(historiaClinicaId: number, soloActivos?: boolean): Observable<CasoClinico[]> {
    return this.casosClinicosService.listarCasosClinicos({
      historiaClinicaId,
      soloActivos,
    });
  }

  abrir(historiaClinicaId: number, body: AbrirCasoClinicoRequest): Observable<CasoClinico> {
    return this.casosClinicosService.abrirCasoClinico({
      historiaClinicaId,
      abrirCasoClinicoRequest: body,
    });
  }

  ver(casoClinicoId: number): Observable<CasoClinico> {
    return this.casosClinicosService.verCasoClinico({
      casoClinicoId,
    });
  }

  editar(casoClinicoId: number, body: EditarCasoClinicoRequest): Observable<CasoClinico> {
    return this.casosClinicosService.editarCasoClinico({
      casoClinicoId,
      editarCasoClinicoRequest: body,
    });
  }

  cerrar(casoClinicoId: number, body: CerrarCasoClinicoRequest): Observable<CasoClinico> {
    return this.casosClinicosService.cerrarCasoClinico({
      casoClinicoId,
      cerrarCasoClinicoRequest: body,
    });
  }

  reabrir(casoClinicoId: number, body: ReabrirCasoClinicoRequest): Observable<CasoClinico> {
    return this.casosClinicosService.reabrirCasoClinico({
      casoClinicoId,
      reabrirCasoClinicoRequest: body,
    });
  }

  /**
   * Cambia el equipo responsable del caso.
   *
   * <p><b>Devuelve la version LEIDA, no la nueva.</b> Encadenar dos cambios de equipo genera un 409
   * de `concurrent-modification`: releer el caso y reintentar.
   */
  cambiarEquipo(casoClinicoId: number, body: EquipoDelCasoRequest): Observable<CasoClinico> {
    return this.casosClinicosService.cambiarEquipoDeCasoClinico({
      casoClinicoId,
      equipoDelCasoRequest: body,
    });
  }

  eventos(casoClinicoId: number): Observable<CasoEvento[]> {
    return this.casosClinicosService.verEventosDeCasoClinico({
      casoClinicoId,
    });
  }
}
