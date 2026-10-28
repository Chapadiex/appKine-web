import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';

import { PerfilPropioStore } from '../../core/services/perfil-propio.store';

/**
 * Quien ingreso y con que rol, al pie de la barra lateral (DP-45).
 *
 * <p><b>La barra la carga con `@defer (on idle)`</b>: la carga inicial esta al borde de su
 * presupuesto y esto no hace falta para el primer render. Hasta que llega —y mientras `/me` no
 * responde, o si falla— el pie muestra el centro, como antes de DP-45.
 *
 * <p>Pide el perfil con un `effect`: {@link PerfilPropioStore#asegurarCargado} lee el sello de
 * cuenta y contexto, asi que cambiar de sede o de cuenta lo vuelve a correr solo.
 */
@Component({
  selector: 'app-quien-ingreso',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="quien__nombre">{{ nombre() ?? centro() }}</span>
    @if (nombre()) {
      <span class="quien__detalle">{{ detalle() }}</span>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .quien__nombre {
      font-size: var(--tipo-xs);
      font-weight: var(--peso-medio);
    }

    .quien__detalle {
      color: var(--color-texto-suave);
      font-size: var(--tipo-2xs);
    }
  `,
})
export class QuienIngreso {
  private readonly perfil = inject(PerfilPropioStore);

  /** Nombre de la organizacion activa: lo que se muestra mientras no hay perfil. */
  readonly centro = input.required<string>();

  protected readonly nombre = computed(() => {
    const perfil = this.perfil.perfil();
    return [perfil?.firstName, perfil?.lastName].filter(Boolean).join(' ') || null;
  });

  /** "Rol · Centro", o el centro solo si el contexto no trae rol. */
  protected readonly detalle = computed(() => {
    const rol = this.perfil.perfil()?.context?.roleLabel;
    return rol ? `${rol} · ${this.centro()}` : this.centro();
  });

  constructor() {
    effect(() => this.perfil.asegurarCargado());
  }
}
