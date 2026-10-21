import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Los iconos que existen. Agregar uno es agregar un `@case` en la plantilla. */
export type NombreDeIcono = 'menu' | 'cerrar';

/**
 * Icono SVG en linea (UX-01, decision §9.3 del plan: sin libreria).
 *
 * <p><b>Decorativo por defecto.</b> `aria-hidden="true"` siempre: el nombre accesible lo pone
 * el boton o el enlace que lo contiene, con texto visible o `aria-label`. Un icono con nombre
 * propio al lado de un texto se lee dos veces.
 *
 * <p><b>Un `@switch` y no `innerHTML`.</b> Cada icono es marcado literal de la plantilla: no
 * pasa por el sanitizador, no necesita `bypassSecurityTrust*` y la CSP con nonce lo cubre.
 *
 * <p>Hereda el color del texto (`currentColor`) y el tamano lo decide quien lo usa con `font-size`.
 */
@Component({
  selector: 'akine-icono, app-icono',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (nombre()) {
      @case ('menu') {
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      }
      @case ('cerrar') {
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      width: 1.25em;
      height: 1.25em;
      vertical-align: -0.3em;
    }
    svg {
      width: 100%;
      height: 100%;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class Icono {
  readonly nombre = input.required<NombreDeIcono>();
}
