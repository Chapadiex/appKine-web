import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ContratacionStore } from '../../core/services/contratacion.store';
import { Icono } from '../../shared/components/icono/icono';

/**
 * dd/mm/aaaa. No usa `formatearFecha` de `shared/utils/instantes` a proposito: la franja vive en
 * el bundle inicial y ese modulo le sumaba 2,3 kB.
 */
const FECHA = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/**
 * Franja del shell con el estado de la prueba gratis (18/11/2026): cuantos dias quedan, o que
 * termino y el centro quedo en solo lectura. No se cierra: es el estado del centro, no un aviso.
 * Fuera de prueba no ocupa lugar.
 *
 * <p>Desde el cobro mensual (contrato 0.191.0) avisa tambien el vencimiento del periodo pagado:
 * por vencer (15 dias o menos), vencido en gracia (3 dias, sigue operando) y en solo lectura hasta
 * el cierre. Es el cartel en la aplicacion que acompaña a los correos de vencimiento.
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
    } @else if (contratacion.avisoDeCobro(); as cobro) {
      @switch (cobro.situacion) {
        @case ('POR_VENCER') {
          <p class="franja" role="status" data-testid="franja-cobro">
            <app-icono class="franja__icono" nombre="info" />
            <span>
              <strong>Tu suscripción vence el {{ fecha(cobro.venceEl) }}</strong>
              ({{ enDias(cobro.diasParaVencer) }}). Si no se renueva, el centro queda en sólo
              lectura y después se cierra.
              <a class="franja__enlace" [href]="pago">Avisanos tu pago</a>
            </span>
          </p>
        }
        @case ('EN_GRACIA') {
          <p class="franja franja--vencida" role="status" data-testid="franja-cobro">
            <app-icono class="franja__icono" nombre="advertencia" />
            <span>
              <strong>Tu suscripción venció el {{ fecha(cobro.venceEl) }}.</strong>
              Seguís operando unos días más; después el centro queda en sólo lectura.
              <a class="franja__enlace" [href]="pago">Avisanos tu pago</a>
            </span>
          </p>
        }
        @case ('SOLO_LECTURA') {
          <p class="franja franja--vencida" role="status" data-testid="franja-cobro">
            <app-icono class="franja__icono" nombre="advertencia" />
            <span>
              <strong>Suscripción vencida: el centro está en sólo lectura.</strong>
              Podés ver y exportar todo, pero no cargar nada nuevo.
              @if (cobro.cierreEl) {
                El acceso se cierra el {{ fecha(cobro.cierreEl) }}.
              }
              <a class="franja__enlace" [href]="pago">Avisanos tu pago</a>
            </span>
          </p>
        }
      }
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

  /** Mientras no haya cobro online, renovar es avisarle el pago a la plataforma. */
  protected readonly pago =
    'mailto:hola@akine.app?subject=Pago%20de%20la%20suscripci%C3%B3n%20AKINE';

  protected fecha(instante: string): string {
    return FECHA.format(new Date(instante));
  }

  protected enDias(dias: number): string {
    if (dias === 0) return 'hoy';
    return dias === 1 ? 'mañana' : `en ${dias} días`;
  }
}
