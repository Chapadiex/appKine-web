import { Injectable, computed, signal } from '@angular/core';

/** Contexto activo: una Organizacion y, opcionalmente, un Consultorio de esa Organizacion. */
export interface TenantContext {
  readonly organizationId: number;
  readonly organizationName: string;
  readonly consultorioId?: number;
  readonly consultorioName?: string;
}

/**
 * Unica fuente de verdad del contexto multi-tenant activo en el frontend.
 *
 * <p><b>Flujo (DP-02).</b> El login autentica una identidad unica, sin seleccion previa de
 * rol. Recien despues el usuario elige Organizacion + Consultorio entre sus contextos
 * autorizados, y esa seleccion produce un access token acotado a ese contexto.
 *
 * <p><b>Por que esto es critico.</b> Cambiar de contexto sin limpiar el estado de las
 * features deja datos de la Organizacion A visibles bajo la Organizacion B. Es el bug de
 * aislamiento mas probable del frontend y el mas grave: expone datos clinicos de otro
 * tenant.
 *
 * Por eso el cambio de contexto emite una senal que las features deben observar para
 * descartar su estado. Un servicio de feature que cachea datos y no reacciona a
 * `contextEpoch` es un bug, no una optimizacion.
 */
@Injectable({ providedIn: 'root' })
export class TenantContextStore {
  private readonly current = signal<TenantContext | null>(null);

  /**
   * Contador que se incrementa en cada cambio de contexto.
   *
   * Las features lo usan como disparador para invalidar sus caches. Se elige un contador
   * en lugar del propio contexto porque tambien debe dispararse al limpiar (logout).
   */
  private readonly epoch = signal(0);

  readonly context = this.current.asReadonly();
  readonly contextEpoch = this.epoch.asReadonly();

  readonly organizationId = computed(() => this.current()?.organizationId ?? null);
  readonly consultorioId = computed(() => this.current()?.consultorioId ?? null);
  readonly hasContext = computed(() => this.current() !== null);

  select(context: TenantContext): void {
    this.current.set(context);
    this.epoch.update((value) => value + 1);
  }

  /**
   * Corrige los NOMBRES del contexto activo sin invalidar el estado de las features (AKINE-LCP).
   *
   * <p>Al recargar, el token trae solo ids y la sesion fija el contexto con un rotulo provisorio;
   * los nombres llegan despues, con `/me/contexts`. Si eso pasara por {@link select}, la epoca
   * avanzaria y todo lo que se cargo con el contexto provisorio —los permisos efectivos, que el
   * menu ya pidio en paralelo— se descartaria y se volveria a pedir, aunque la organizacion y
   * la sede sean las mismas. Con otros ids no es un renombre: delega en {@link select}.
   */
  renombrar(context: TenantContext): void {
    const actual = this.current();
    if (
      actual === null ||
      actual.organizationId !== context.organizationId ||
      actual.consultorioId !== context.consultorioId
    ) {
      this.select(context);
      return;
    }
    this.current.set(context);
  }

  clear(): void {
    this.current.set(null);
    this.epoch.update((value) => value + 1);
  }
}
