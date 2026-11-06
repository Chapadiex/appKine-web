import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { catchError, of } from 'rxjs';

import { ConsultoriosService } from '../../api/generated/api/consultorios.service';
import { ConsultorioResponse } from '../../api/generated/model/consultorio-response';
import { TenantContextStore } from './tenant-context.store';

/**
 * La sede del contexto activo, con su ficha completa (direccion, punto en el mapa, contacto).
 *
 * <p>El contexto solo trae el id y el nombre de la sede; para ofrecer "Cómo llegar" en un turno
 * o la direccion en un aviso hace falta la ficha. Vive en `core/` porque la piden features
 * distintos (scheduling, organization) y un feature no importa de otro (AGENT.md 4.4).
 *
 * <p>Se lee una vez por contexto y a pedido: {@link asegurarCargada} dispara la lectura la
 * primera vez que alguien la necesita bajo esta epoca de contexto. Cambiar de sede o de
 * organizacion invalida lo leido, que es lo que evita mostrar la direccion de la sede anterior.
 */
@Injectable({ providedIn: 'root' })
export class SedeActivaStore {
  private readonly consultorios = inject(ConsultoriosService);
  private readonly tenant = inject(TenantContextStore);

  private readonly cache = signal<{
    readonly epoca: number;
    readonly sede: ConsultorioResponse | null;
  } | null>(null);

  private readonly vigente = computed(() => {
    const cache = this.cache();
    return cache !== null && cache.epoca === this.tenant.contextEpoch() ? cache : null;
  });

  /** La ficha de la sede activa, o `null` mientras no se leyo o si fallo la lectura. */
  readonly sede: Signal<ConsultorioResponse | null> = computed(() => this.vigente()?.sede ?? null);

  private epocaEnVuelo: number | null = null;

  /** Lee la ficha si no esta leida para este contexto. Idempotente: no repite lecturas. */
  asegurarCargada(): void {
    const epoca = this.tenant.contextEpoch();
    if (this.vigente() !== null || this.epocaEnVuelo === epoca) {
      return;
    }
    const orgId = this.tenant.organizationId();
    const consultorioId = this.tenant.consultorioId();
    if (orgId === null || consultorioId === null) {
      return;
    }
    this.epocaEnVuelo = epoca;
    this.consultorios
      .getConsultorio({ orgId, consultorioId })
      .pipe(catchError(() => of(null)))
      .subscribe((sede) => {
        if (this.epocaEnVuelo === epoca) {
          this.epocaEnVuelo = null;
        }
        // Una lectura que llega despues de cambiar de contexto describe otra sede: se descarta.
        if (this.tenant.contextEpoch() === epoca) {
          this.cache.set({ epoca, sede });
        }
      });
  }
}
