import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Icono, esNombreDeIcono } from '../icono/icono';
import { ICONO_DE_SECCION, normalizarTitulo, trazoDelManual } from './iconos-de-texto';
import { parsearMarkdown } from './parsear-markdown';

/** Una captura que la persona quiere ver en grande. */
export interface CapturaAmpliada {
  readonly src: string;
  readonly alt: string;
}

/**
 * Dibuja el Markdown de una ficha del manual con plantilla Angular: nada pasa por `innerHTML`, así que
 * el contenido no puede inyectar marcado (docs/diseno/AKINE-manual-de-usuario.md §5.7).
 */
@Component({
  selector: 'app-markdown-seguro',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icono, NgTemplateOutlet, RouterLink],
  template: `
    @for (bloque of bloques(); track $index) {
      @switch (bloque.tipo) {
        @case ('titulo') {
          @if (bloque.nivel === 2) {
            <h3 class="manual__seccion">
              @if (iconoDeSeccion(bloque.texto); as trazo) {
                <app-icono [trazo]="trazo" />
              }
              <ng-container *ngTemplateOutlet="enLinea; context: { $implicit: bloque.contenido }" />
            </h3>
          } @else {
            <h4 class="manual__tarea">
              <ng-container *ngTemplateOutlet="enLinea; context: { $implicit: bloque.contenido }" />
            </h4>
          }
        }
        @case ('parrafo') {
          <p>
            <ng-container *ngTemplateOutlet="enLinea; context: { $implicit: bloque.contenido }" />
          </p>
        }
        @case ('lista-ordenada') {
          <ol class="manual__pasos">
            @for (item of bloque.items; track $index) {
              <li><ng-container *ngTemplateOutlet="enLinea; context: { $implicit: item }" /></li>
            }
          </ol>
        }
        @case ('lista') {
          <ul>
            @for (item of bloque.items; track $index) {
              <li><ng-container *ngTemplateOutlet="enLinea; context: { $implicit: item }" /></li>
            }
          </ul>
        }
        @case ('aviso') {
          <div
            class="manual__aviso"
            [class.manual__aviso--consejo]="bloque.variante === 'consejo'"
            role="note"
          >
            <app-icono [trazo]="trazoDe(bloque.variante)" />
            <p>
              <strong>{{ bloque.variante === 'consejo' ? 'Consejo' : 'Importante' }}:</strong>
              <ng-container *ngTemplateOutlet="enLinea; context: { $implicit: bloque.contenido }" />
            </p>
          </div>
        }
        @case ('captura') {
          <button
            type="button"
            class="manual__captura"
            [attr.aria-label]="'Ampliar la imagen: ' + bloque.alt"
            (click)="
              ampliar.emit({ src: urlDeCaptura(bloque.ficha, bloque.nombre), alt: bloque.alt })
            "
          >
            <img
              [src]="urlDeCaptura(bloque.ficha, bloque.nombre)"
              [alt]="bloque.alt"
              loading="lazy"
            />
          </button>
        }
      }
    }

    <ng-template #enLinea let-partes>
      @for (parte of $any(partes); track $index) {
        @switch (parte.tipo) {
          @case ('negrita') {
            <strong>{{ parte.texto }}</strong>
          }
          @case ('icono') {
            @if (esIconoConocido(parte.nombre)) {
              <app-icono
                class="manual__icono"
                [nombre]="$any(parte.nombre)"
                [trazo]="trazoDe(parte.nombre)"
              />
            }
          }
          @case ('enlace') {
            <a [routerLink]="parte.ruta">{{ parte.texto }}</a>
          }
          @case ('marca') {
            <span class="manual__marca" [attr.aria-label]="'marca ' + parte.numero">{{
              parte.numero
            }}</span>
          }
          @default {
            {{ parte.texto }}
          }
        }
      }
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
      line-height: 1.55;
      color: var(--color-texto);
    }
    .manual__seccion {
      display: flex;
      align-items: center;
      gap: var(--esp-4);
      margin: var(--esp-7) 0 var(--esp-4);
      font-size: var(--esp-6);
      color: var(--color-texto-fuerte);
    }
    .manual__seccion app-icono {
      color: var(--color-accion-fondo);
    }
    .manual__tarea {
      margin: var(--esp-6) 0 var(--esp-4);
      font-size: 0.95rem;
    }
    p,
    ul,
    ol {
      margin: 0 0 var(--esp-5);
    }
    ul,
    ol {
      padding-inline-start: var(--esp-7);
    }
    li + li {
      margin-top: var(--esp-2);
    }
    .manual__icono {
      color: var(--color-accion-fondo);
    }
    .manual__marca {
      display: inline-grid;
      place-items: center;
      min-width: 1.35em;
      height: 1.35em;
      margin-inline-start: 0.2em;
      border-radius: 999px;
      background: var(--color-accion-fondo);
      color: var(--color-accion-texto);
      font-size: 0.8em;
      font-weight: 700;
      vertical-align: 0.05em;
    }
    .manual__aviso {
      display: flex;
      gap: var(--esp-4);
      align-items: flex-start;
      margin: 0 0 var(--esp-5);
      padding: var(--esp-5);
      border-inline-start: 3px solid var(--color-aviso);
      border-radius: var(--radio-md);
      background: var(--color-aviso-fondo);
    }
    .manual__aviso app-icono {
      color: var(--color-aviso);
      margin-top: 0.15em;
    }
    .manual__aviso--consejo {
      border-inline-start-color: var(--color-info);
      background: var(--color-info-fondo);
    }
    .manual__aviso--consejo app-icono {
      color: var(--color-info);
    }
    .manual__aviso p {
      margin: 0;
    }
    .manual__captura {
      display: block;
      width: 100%;
      margin: 0 0 var(--esp-5);
      padding: 0;
      border: 1px solid var(--color-borde);
      border-radius: var(--radio-md);
      background: var(--color-superficie);
      cursor: zoom-in;
      overflow: hidden;
    }
    .manual__captura img {
      display: block;
      width: 100%;
      height: auto;
    }
  `,
})
export class MarkdownSeguro {
  readonly markdown = input.required<string>();
  readonly ampliar = output<CapturaAmpliada>();

  protected readonly bloques = computed(() => parsearMarkdown(this.markdown()));

  protected urlDeCaptura(ficha: string, nombre: string): string {
    return `/manual/${ficha}/${nombre}.png`;
  }

  protected esIconoConocido(nombre: string): boolean {
    return esNombreDeIcono(nombre) || trazoDelManual(nombre) !== undefined;
  }

  /** Trazo propio del manual, o `undefined` para que `app-icono` use el de la aplicación. */
  protected trazoDe(nombre: string): string | undefined {
    return trazoDelManual(nombre);
  }

  protected iconoDeSeccion(titulo: string): string | undefined {
    const icono = ICONO_DE_SECCION[normalizarTitulo(titulo)];
    return icono ? trazoDelManual(icono) : undefined;
  }
}
