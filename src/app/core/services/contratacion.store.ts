import { Injectable, Signal, computed, effect, inject, signal, untracked } from '@angular/core';

import { ContratacionService } from '../../api/generated/api/contratacion.service';
import { ContratacionResponse } from '../../api/generated/model/contratacion-response';
import { SessionService } from './session.service';
import { TenantContextStore } from './tenant-context.store';

/** Servicio que un centro contrata (contrato 0.178.0). */
export type ServicioContratable = 'KINESIOLOGIA' | 'ACTIVIDADES';

/** Milisegundos de un dia, para contar los que le quedan a la prueba. */
const UN_DIA = 86_400_000;

/**
 * Lo que el centro activo tiene contratado (18/11/2026): plan, servicios, IA y prueba gratis.
 *
 * <p>Decide que se ve, no que se puede hacer: el servidor responde 409 `feature-not-available` a
 * una operacion de un servicio no contratado. Por eso, si la lectura falla, se muestra todo (como
 * {@link FuncionesIaStore}): esconder pantallas por un error de red dejaria al centro sin su
 * propio sistema.
 *
 * <p>Se relee al cambiar de contexto o de sesion, para que no quede la contratacion de otro centro.
 */
@Injectable({ providedIn: 'root' })
export class ContratacionStore {
  private readonly api = inject(ContratacionService);
  private readonly tenant = inject(TenantContextStore);
  private readonly session = inject(SessionService);

  private readonly actual = signal<ContratacionResponse | null>(null);
  private readonly fallo = signal(false);

  readonly contratacion: Signal<ContratacionResponse | null> = this.actual.asReadonly();

  /** Si la prueba gratis sigue corriendo, los dias que le quedan (redondeado hacia arriba). */
  readonly diasDePrueba = computed<number | null>(() => {
    const c = this.actual();
    if (c?.estado !== 'PRUEBA' || !c.pruebaHasta || c.soloLectura) {
      return null;
    }
    return Math.max(0, Math.ceil((Date.parse(c.pruebaHasta) - Date.now()) / UN_DIA));
  });

  /** La prueba termino y el centro quedo en solo lectura. */
  readonly pruebaVencida = computed(
    () => this.actual()?.estado === 'PRUEBA' && this.actual()?.soloLectura === true,
  );

  constructor() {
    effect(() => {
      this.tenant.contextEpoch();
      this.session.estado();
      untracked(() => this.recargar());
    });
  }

  /** `true` si el servicio esta contratado, o si todavia no se sabe o no se pudo leer. */
  tiene(servicio: ServicioContratable): boolean {
    const c = this.actual();
    if (this.fallo() || c === null) {
      return true;
    }
    return (c.servicios as readonly string[]).includes(servicio);
  }

  recargar(): void {
    const orgId = this.tenant.organizationId();
    this.actual.set(null);
    this.fallo.set(false);
    if (orgId === null || this.session.estado() !== 'activa') {
      return;
    }
    this.api.getContratacionDeOrganizacion({ orgId }).subscribe({
      next: (contratacion) => {
        if (this.tenant.organizationId() === orgId) {
          this.actual.set(contratacion);
        }
      },
      error: () => {
        if (this.tenant.organizationId() === orgId) {
          this.fallo.set(true);
        }
      },
    });
  }
}
