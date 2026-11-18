import { Injectable, Signal, computed, effect, inject, signal, untracked } from '@angular/core';

import { InteligenciaArtificialDelCentroService } from '../../api/generated/api/inteligencia-artificial-del-centro.service';
import { FuncionesIaResponse } from '../../api/generated/model/funciones-ia-response';
import { SessionService } from './session.service';
import { TenantContextStore } from './tenant-context.store';

/** Las funciones de IA que un centro puede prender o apagar. */
export type FuncionIa = 'ASISTENTE' | 'EVOLUCION' | 'SUGERENCIAS' | 'BIBLIOTECA';

/**
 * Que funciones de IA estan activas en el centro: el servidor las ofrece y el centro no las apago
 * (Organizacion → Inteligencia artificial). Decide si se ven el asistente, la biblioteca y la
 * evolucion del caso.
 *
 * <p><b>Mientras no se sabe, nada se muestra</b>: un enlace que aparece y desaparece al cargar es peor
 * que uno que aparece un instante despues. <b>Si la lectura falla</b> (backend viejo, red), se
 * muestra todo: la autoridad es el backend, que responde 409 o 404 si la funcion esta apagada, y
 * esconder una pantalla por un error de red dejaria al centro sin ella.
 *
 * <p>Cambia con el contexto, igual que la marca.
 */
@Injectable({ providedIn: 'root' })
export class FuncionesIaStore {
  private readonly api = inject(InteligenciaArtificialDelCentroService);
  private readonly tenant = inject(TenantContextStore);
  private readonly session = inject(SessionService);

  private readonly actual = signal<FuncionesIaResponse | null>(null);
  private readonly fallo = signal(false);

  /** Lo ultimo leido o guardado; `null` mientras no se sabe. */
  readonly funciones: Signal<FuncionesIaResponse | null> = this.actual.asReadonly();

  private readonly activas = computed<ReadonlySet<string> | 'todas' | null>(() => {
    if (this.fallo()) {
      return 'todas';
    }
    const leidas = this.actual();
    return leidas === null
      ? null
      : new Set(leidas.funciones.filter((f) => f.activa).map((f) => f.funcion as string));
  });

  constructor() {
    effect(() => {
      this.tenant.contextEpoch();
      this.session.estado();
      untracked(() => this.recargar());
    });
  }

  /** `true` cuando ya se leyo (o fallo la lectura): hasta entonces, nada esta activo. */
  readonly sabe = computed(() => this.activas() !== null);

  /** `true` si la funcion esta activa en el centro. Mientras no se sabe, `false`. */
  activa(funcion: FuncionIa): boolean {
    const activas = this.activas();
    return activas === 'todas' || (activas !== null && activas.has(funcion));
  }

  /** Vuelve a leer las funciones del centro activo. */
  recargar(): void {
    const orgId = this.tenant.organizationId();
    this.actual.set(null);
    this.fallo.set(false);
    if (orgId === null || this.session.estado() !== 'activa') {
      return;
    }
    this.api.getFuncionesIaDeOrganizacion({ orgId }).subscribe({
      next: (funciones) => {
        if (this.tenant.organizationId() === orgId) {
          this.actual.set(funciones);
        }
      },
      error: () => {
        if (this.tenant.organizationId() === orgId) {
          this.fallo.set(true);
        }
      },
    });
  }

  /** Pone en uso lo recien guardado en la pantalla de configuracion. */
  adoptar(funciones: FuncionesIaResponse): void {
    this.fallo.set(false);
    this.actual.set(funciones);
  }
}
