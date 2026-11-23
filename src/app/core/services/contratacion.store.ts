import { Injectable, Signal, computed, effect, inject, signal, untracked } from '@angular/core';

import { ContratacionService } from '../../api/generated/api/contratacion.service';
import { ContratacionResponse } from '../../api/generated/model/contratacion-response';
import { SessionService } from './session.service';
import { TenantContextStore } from './tenant-context.store';

/** Servicio que un centro contrata (contrato 0.178.0). */
export type ServicioContratable = 'KINESIOLOGIA' | 'ACTIVIDADES';

/** Lo que la franja del shell necesita para avisar del cobro mensual. */
export interface AvisoDeCobro {
  readonly situacion: 'POR_VENCER' | 'EN_GRACIA' | 'SOLO_LECTURA';
  /** Instante hasta el que esta pagado. */
  readonly venceEl: string;
  /** Instante en que se cierra el acceso si no paga. */
  readonly cierreEl: string | null;
  readonly diasParaVencer: number;
  readonly diasParaCierre: number | null;
}

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

  /**
   * El aviso del cobro mensual que el centro tiene que ver (contrato 0.191.0): por vencer (15 dias
   * o menos), vencida en gracia o en solo lectura por falta de pago. `null` si esta al dia, sin
   * control de cobro o todavia no se leyo. `SIN_ACCESO` no llega aca: ese centro no entra.
   */
  readonly avisoDeCobro = computed<AvisoDeCobro | null>(() => {
    const c = this.actual();
    const situacion = c?.situacionDeCobro;
    if (
      (situacion !== 'POR_VENCER' && situacion !== 'EN_GRACIA' && situacion !== 'SOLO_LECTURA') ||
      !c?.pagadoHasta
    ) {
      return null;
    }
    const venceEn = Date.parse(c.pagadoHasta);
    const cierreEn = c.cierreEl ? Date.parse(c.cierreEl) : Number.NaN;
    return {
      situacion,
      venceEl: c.pagadoHasta,
      cierreEl: c.cierreEl ?? null,
      diasParaVencer: Math.max(0, Math.ceil((venceEn - Date.now()) / UN_DIA)),
      diasParaCierre: Number.isNaN(cierreEn)
        ? null
        : Math.max(0, Math.ceil((cierreEn - Date.now()) / UN_DIA)),
    };
  });

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
