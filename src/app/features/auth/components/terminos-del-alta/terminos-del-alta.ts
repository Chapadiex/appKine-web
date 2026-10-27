import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { TerminosVigentes } from '../../models/terminos-vigentes';

/**
 * Casilla "Acepto los términos y condiciones" de un alta (DP-45): registro e invitacion con
 * cuenta nueva.
 *
 * <p>Muestra lo que dijo `GET /api/v1/terms`: nada si el despliegue no exige terminos; la casilla,
 * la version y el enlace al texto si los exige (el texto legal no lo sirve el backend, solo su
 * `url`); y un aviso con "Reintentar" si no se pudieron leer, porque sin ellos el alta no sale.
 * El estado vive en {@link TerminosVigentes}, que es del formulario que lo envia.
 */
@Component({
  selector: 'app-terminos-del-alta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let t = terminos();
    @switch (t.estado().tipo) {
      @case ('cargando') {
        <p class="ayuda">Leyendo los términos y condiciones vigentes&hellip;</p>
      }
      @case ('error') {
        <div class="terminos__fallo">
          <p class="estado estado--error" role="alert">
            No pudimos leer los términos y condiciones vigentes, y sin ellos no se puede crear la
            cuenta.
          </p>
          <button type="button" class="boton boton--secundario" (click)="t.cargar()">
            Reintentar
          </button>
        </div>
      }
      @case ('listo') {
        @if (t.versionExigida(); as version) {
          <div class="campo">
            <label class="terminos__casilla" [for]="idCasilla()">
              <input
                type="checkbox"
                [id]="idCasilla()"
                [checked]="t.aceptados()"
                (change)="alternar($event)"
                [attr.aria-invalid]="mostrarError()"
                [attr.aria-describedby]="describedBy()"
              />
              Acepto los términos y condiciones
            </label>
            <p class="ayuda" [id]="idCasilla() + '-ayuda'">
              @if (url(); as enlace) {
                <a [href]="enlace" target="_blank" rel="noopener noreferrer"
                  >Leer los términos y condiciones<span class="visualmente-oculto">
                    (se abren en otra pestaña)</span
                  ></a
                >
                ·
              }
              Versión {{ version }}
            </p>
            @if (mostrarError()) {
              <p class="campo__error" [id]="idCasilla() + '-error'">
                Para crear la cuenta tenés que aceptar los términos y condiciones.
              </p>
            }
          </div>
        }
      }
    }
  `,
  styles: `
    .terminos__fallo {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--esp-4);
    }

    .terminos__fallo .estado {
      margin: 0;
    }

    .campo .terminos__casilla {
      display: flex;
      align-items: center;
      gap: var(--esp-4);
      min-height: 1.5rem;
      font-size: var(--tipo-xs);
    }

    .terminos__casilla input {
      width: auto;
      min-height: 0;
      margin: 0;
      padding: 0;
    }
  `,
})
export class TerminosDelAlta {
  readonly terminos = input.required<TerminosVigentes>();

  /** Prefijo de los ids: "registro" da `registro-terminos`. */
  readonly prefijo = input.required<string>();

  /** Pintar el error "tenés que aceptar": lo decide el formulario al enviar. */
  readonly mostrarError = input(false);

  protected readonly idCasilla = computed(() => `${this.prefijo()}-terminos`);

  protected readonly url = computed(() => {
    const estado = this.terminos().estado();
    return estado.tipo === 'listo' ? (estado.terminos.url ?? null) : null;
  });

  protected readonly describedBy = computed(
    () => `${this.idCasilla()}-ayuda` + (this.mostrarError() ? ` ${this.idCasilla()}-error` : ''),
  );

  protected alternar(evento: Event): void {
    this.terminos().aceptados.set((evento.target as HTMLInputElement).checked);
  }
}
