import {
  Component,
  DestroyRef,
  ViewContainerRef,
  afterNextRender,
  inject,
  input,
  inputBinding,
  output,
  outputBinding,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { RUTA_INICIO } from '../navegacion-principal/secciones';

/**
 * Lugar de la barra superior en la carga inicial (07/11/2026).
 *
 * <p>La {@link BarraSuperior} de verdad llega en su propio chunk despues de la primera pintura,
 * como la barra lateral: con el icono que arrastra suman mas de 15 kB y la carga inicial esta al
 * borde de su presupuesto. No va en `@defer`, que suma su runtime (~7 kB) a la carga inicial.
 *
 * <p>Mientras no llega, este componente ocupa el mismo alto y muestra la marca, que es justo lo que
 * la barra dibuja mientras la sesion se restaura: en una recarga la barra no salta. Cuando llega,
 * le pasa `menuAbierto` y le reenvia `alternarMenu`; el shell no se entera del cambio.
 */
@Component({
  selector: 'app-barra-superior-diferida',
  imports: [RouterLink],
  template: `
    @if (!montada()) {
      <a class="marca" [routerLink]="rutaInicio">AKINE</a>
    }
    <ng-container #ancla />
  `,
  // Los mismos valores que `barra-superior.css` para su `:host` y su marca.
  styles: `
    :host {
      display: flex;
      align-items: center;
      width: 100%;
      min-height: var(--alto-barra-superior);
    }

    .marca {
      color: var(--color-texto-fuerte);
      font-size: var(--tipo-lg);
      font-weight: var(--peso-fuerte);
      letter-spacing: 0.08em;
      text-decoration: none;
    }
  `,
})
export class BarraSuperiorDiferida {
  /** Si la barra lateral esta desplegada (tablet). Se le pasa tal cual a la barra. */
  readonly menuAbierto = input(false);

  /** El usuario pidio abrir o cerrar la barra lateral. */
  readonly alternarMenu = output<void>();

  protected readonly rutaInicio = RUTA_INICIO;

  /** Ya esta la barra de verdad: la marca de reserva se va. */
  protected readonly montada = signal(false);

  private readonly ancla = viewChild.required('ancla', { read: ViewContainerRef });

  constructor() {
    // La barra montada muere con el ancla; lo que hay que evitar es montarla despues.
    let destruido = false;
    inject(DestroyRef).onDestroy(() => (destruido = true));

    afterNextRender(() => {
      import('./barra-superior').then(
        (m) => {
          if (destruido) {
            return;
          }
          this.ancla().createComponent(m.BarraSuperior, {
            bindings: [
              inputBinding('menuAbierto', this.menuAbierto),
              outputBinding('alternarMenu', () => this.alternarMenu.emit()),
            ],
          });
          this.montada.set(true);
        },
        // Sin el chunk (red caida, despliegue nuevo) queda la marca.
        () => undefined,
      );
    });
  }
}
