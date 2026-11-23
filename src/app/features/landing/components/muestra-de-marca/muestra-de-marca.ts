import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

import { Icono } from '../../../../shared/components/icono/icono';

interface Paleta {
  readonly nombre: string;
  /** Tokens de la landing: el color principal y el acento de la muestra. */
  readonly principal: string;
  readonly acento: string;
}

/**
 * Muestra de la marca propia (Organización → Marca, 12/11/2026): se elige una paleta y la app de
 * ejemplo cambia de color. Ilustración con datos inventados; los botones de paleta sí se usan.
 */
@Component({
  selector: 'app-muestra-de-marca',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icono],
  templateUrl: './muestra-de-marca.html',
  styleUrl: './muestra-de-marca.css',
})
export class MuestraDeMarca {
  protected readonly paletas: readonly Paleta[] = [
    {
      nombre: 'Menta',
      principal: 'var(--color-landing-menta)',
      acento: 'var(--color-landing-forma-menta)',
    },
    {
      nombre: 'Coral',
      principal: 'var(--color-landing-accion)',
      acento: 'var(--color-landing-forma-coral)',
    },
    {
      nombre: 'Violeta',
      principal: 'var(--color-ia-vivo-desde)',
      acento: 'var(--color-ia-fondo)',
    },
    {
      nombre: 'Noche',
      principal: 'var(--color-banda-fondo)',
      acento: 'var(--color-landing-forma-sol)',
    },
  ];

  protected readonly elegida = signal(0);
  protected readonly paleta = computed(() => this.paletas[this.elegida()]);
}
