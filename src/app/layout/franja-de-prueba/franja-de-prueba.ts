import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ContratacionStore } from '../../core/services/contratacion.store';
import { Icono } from '../../shared/components/icono/icono';

/**
 * Franja del shell con el estado de la prueba gratis (18/11/2026): cuantos dias quedan, o que
 * termino y el centro quedo en solo lectura. No se cierra: es el estado del centro, no un aviso.
 * Fuera de prueba no ocupa lugar.
 */
@Component({
  selector: 'app-franja-de-prueba',
  imports: [Icono],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (contratacion.pruebaVencida()) {
      <p class="franja franja--vencida" role="status">
        <app-icono class="franja__icono" nombre="advertencia" />
        <span>
          <strong>Tu prueba gratis terminó.</strong>
          El centro quedó en sólo lectura: podés ver y exportar todo, pero no cargar nada nuevo.
          Para seguir, <a class="franja__enlace" [href]="contacto">escribinos y elegí tu plan</a>.
        </span>
      </p>
    } @else if (contratacion.diasDePrueba(); as dias) {
      <p class="franja" role="status">
        <app-icono class="franja__icono" nombre="info" />
        <span>
          <strong>Prueba gratis:</strong>
          {{ dias === 1 ? 'te queda 1 día' : 'te quedan ' + dias + ' días' }}.
          <a class="franja__enlace" [href]="contacto">Elegí tu plan</a>
        </span>
      </p>
    } @else if (contratacion.diasDePrueba() === 0) {
      <p class="franja" role="status">
        <app-icono class="franja__icono" nombre="info" />
        <span>
          <strong>Prueba gratis:</strong> termina hoy.
          <a class="franja__enlace" [href]="contacto">Elegí tu plan</a>
        </span>
      </p>
    }
  `,
  styles: `
    .franja {
      display: flex;
      align-items: flex-start;
      gap: var(--espacio-2, 0.5rem);
      margin: 0;
      padding: var(--espacio-2, 0.5rem) var(--espacio-4, 1rem);
      background: var(--color-info-fondo);
      color: var(--color-info-texto);
      border-bottom: 1px solid var(--color-info);
      font-size: 0.875rem;
      line-height: 1.4;
    }
    .franja--vencida {
      background: var(--color-aviso-fondo);
      color: var(--color-aviso-texto);
      border-bottom-color: var(--color-aviso);
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
export class FranjaDePrueba {
  protected readonly contratacion = inject(ContratacionStore);

  /** Mientras no haya cobro online, contratar es escribirle a la plataforma. */
  protected readonly contacto = 'mailto:hola@akine.app?subject=Quiero%20contratar%20AKINE';
}
