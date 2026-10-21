import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Los iconos que existen. Agregar uno es agregar un `@case` en la plantilla. */
export type NombreDeIcono =
  | 'menu'
  | 'cerrar'
  | 'ayuda'
  | 'flecha-abajo'
  | 'operacion'
  | 'pacientes'
  | 'actividades'
  | 'economia'
  | 'configuracion'
  | 'plataforma';

/**
 * Icono SVG en linea (UX-01, decision §9.3 del plan: sin libreria). Trazos propios de 24 px.
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
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      @switch (nombre()) {
        @case ('menu') {
          <path d="M3 6h18M3 12h18M3 18h18" />
        }
        @case ('cerrar') {
          <path d="M6 6l12 12M18 6L6 18" />
        }
        @case ('ayuda') {
          <circle cx="12" cy="12" r="9.5" />
          <path d="M9.5 9.2a2.6 2.6 0 0 1 5 1c0 1.8-2.5 2.3-2.5 3.8" />
          <path d="M12 17.2h.01" />
        }
        @case ('flecha-abajo') {
          <path d="M6 9l6 6 6-6" />
        }
        @case ('operacion') {
          <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        }
        @case ('pacientes') {
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
          <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.5 3.5 5.2" />
        }
        @case ('actividades') {
          <path d="M3 12h3.5l2.5-6 4 12 2.5-6H21" />
        }
        @case ('economia') {
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18M7 15h3" />
        }
        @case ('configuracion') {
          <circle cx="12" cy="12" r="3" />
          <path
            d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"
          />
        }
        @case ('plataforma') {
          <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3z" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-shrink: 0;
      width: 1.25em;
      height: 1.25em;
      vertical-align: -0.3em;
    }
    svg {
      width: 100%;
      height: 100%;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class Icono {
  readonly nombre = input.required<NombreDeIcono>();
}
