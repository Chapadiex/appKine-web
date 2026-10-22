import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Un paso de la ruta de navegacion. Sin `ruta` es la pantalla actual y no es un enlace. */
export interface Miga {
  readonly etiqueta: string;

  readonly ruta?: string | readonly unknown[] | null;
}

/**
 * Ruta de navegacion ("migas"): de donde viene la pantalla, como enlaces separados por "/".
 *
 * <p>Reemplaza a las seis copias que cada feature tenia en su CSS, con marcados distintos
 * (`a.migas` suelto, `nav.migas > a`, `nav.migas` con un unico "Volver a..."). Ahora es una sola
 * lista ordenada dentro de un `nav` con nombre, que es el patron de WCAG para breadcrumbs.
 *
 * <p><b>Dos usos.</b> Arriba del titulo, en su propio renglon (el default); o `enLinea`, dentro de
 * la fila del titulo y antes del `h1`, que es lo que hacen las pantallas hijas de una ficha
 * (Historia clinica / Caso / Plan): ahi la miga termina con un "/" que la une al titulo.
 *
 * <p><b>No sabe de dominio.</b> Recibe etiquetas y rutas. Los separadores los dibuja el CSS de
 * `design-system.css` (`.migas__item + .migas__item::before`), asi que el lector de pantalla no
 * los lee.
 */
@Component({
  selector: 'app-migas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <nav class="migas" [class.migas--en-linea]="enLinea()" [attr.aria-label]="etiqueta()">
      <ol class="migas__lista">
        @for (miga of migas(); track $index) {
          <li class="migas__item">
            @if (miga.ruta) {
              <a class="migas__enlace" [routerLink]="miga.ruta">{{ miga.etiqueta }}</a>
            } @else {
              <span class="migas__actual" aria-current="page">{{ miga.etiqueta }}</span>
            }
          </li>
        }
      </ol>
    </nav>
  `,
  styles: `
    :host {
      display: contents;
    }
  `,
})
export class Migas {
  readonly migas = input.required<readonly Miga[]>();

  /** Dentro de la fila del titulo, antes del `h1`: termina con un separador. */
  readonly enLinea = input(false, { transform: booleanAttribute });

  /** Nombre del `nav`. Uno solo por pantalla, salvo que dos rutas convivan. */
  readonly etiqueta = input('Ruta de navegación');
}
