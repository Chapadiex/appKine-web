import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';

import { ContratacionStore } from '../../core/services/contratacion.store';
import { Icono } from '../../shared/components/icono/icono';
import { SECCIONES, seccionDe } from '../navegacion-principal/secciones';

const NOMBRE: Readonly<Record<string, string>> = {
  KINESIOLOGIA: 'Kinesiología',
  ACTIVIDADES: 'Actividades y clases',
};

/**
 * Franja del shell cuando la pantalla es de un servicio que el centro dejó de tener (26/11/2026):
 * se puede consultar todo, pero el servidor rechaza altas y cambios. No se cierra: es el estado de
 * la pantalla, no un aviso. En las demás pantallas no ocupa lugar.
 */
@Component({
  selector: 'app-franja-de-solo-lectura',
  imports: [Icono, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (servicio(); as nombre) {
      <p class="franja" role="status" data-testid="franja-solo-lectura">
        <app-icono class="franja__icono" nombre="candado" />
        <span>
          <strong>{{ nombre }} en solo lectura.</strong>
          El centro dejó de tenerlo contratado: podés consultar todo, pero no cargar ni cambiar
          nada. Para volver a usarlo,
          <a class="franja__enlace" routerLink="/organizacion/suscripcion">pedí sumarlo</a>.
        </span>
      </p>
    }
  `,
  styles: `
    .franja {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      margin: 0;
      padding: 0.5rem 1rem;
      background: var(--color-aviso-fondo);
      color: var(--color-aviso-texto);
      border-bottom: 1px solid var(--color-aviso);
      font-size: 0.875rem;
      line-height: 1.4;
    }
    .franja__icono {
      flex: none;
      margin-top: 0.1rem;
    }
    .franja__enlace {
      color: inherit;
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
  `,
})
export class FranjaDeSoloLectura {
  private readonly contratacion = inject(ContratacionStore);
  private readonly router = inject(Router);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** Nombre del servicio en solo lectura de la pantalla actual, o `null`. */
  protected readonly servicio = computed(() => {
    const servicio = seccionDe(this.url(), SECCIONES)?.servicio;
    return servicio && this.contratacion.enLectura(servicio) ? NOMBRE[servicio] : null;
  });
}
