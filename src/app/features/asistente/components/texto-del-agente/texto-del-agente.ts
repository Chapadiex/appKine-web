import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

import { parsearTextoDelAgente } from '../../models/texto-del-agente';

/**
 * El texto del agente con formato liviano. Todo sale por interpolación y `routerLink`: un `<b>` o un
 * `<script>` en la respuesta se ve como texto.
 */
@Component({
  selector: 'app-texto-del-agente',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink],
  host: { class: 'texto-del-agente' },
  template: `
    @for (bloque of bloques(); track $index) {
      @switch (bloque.tipo) {
        @case ('parrafo') {
          <p><ng-container *ngTemplateOutlet="tramos; context: { $implicit: bloque.tramos }" /></p>
        }
        @case ('lista') {
          <ul>
            @for (item of bloque.items; track $index) {
              <li><ng-container *ngTemplateOutlet="tramos; context: { $implicit: item }" /></li>
            }
          </ul>
        }
        @case ('lista-ordenada') {
          <ol>
            @for (item of bloque.items; track $index) {
              <li><ng-container *ngTemplateOutlet="tramos; context: { $implicit: item }" /></li>
            }
          </ol>
        }
      }
    }
    <ng-template #tramos let-lista>
      @for (t of lista; track $index) {
        @switch (t.tipo) {
          @case ('negrita') {
            <strong>{{ t.texto }}</strong>
          }
          @case ('enlace') {
            <a [routerLink]="t.ruta" [queryParams]="t.query">{{ t.texto }}</a>
          }
          @default {
            {{ t.texto }}
          }
        }
      }
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
      overflow-wrap: anywhere;
    }
    p,
    ul,
    ol {
      margin: 0;
    }
    p {
      white-space: pre-line;
    }
    p + p,
    p + ul,
    p + ol,
    ul + p,
    ol + p,
    ul + ul,
    ol + ol {
      margin-top: var(--esp-2);
    }
    ul,
    ol {
      padding-left: var(--esp-7);
    }
    li + li {
      margin-top: var(--esp-1);
    }
    strong {
      font-weight: var(--peso-semi);
      color: var(--color-texto-fuerte);
    }
    a {
      color: var(--color-enlace);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
  `,
})
export class TextoDelAgente {
  readonly texto = input.required<string>();
  protected readonly bloques = computed(() => parsearTextoDelAgente(this.texto()));
}
