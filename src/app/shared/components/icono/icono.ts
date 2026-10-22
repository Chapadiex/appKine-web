import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Los iconos que existen. Agregar uno es agregar un `@case` en la plantilla. */
export type NombreDeIcono =
  | 'correo'
  | 'menu'
  | 'cerrar'
  | 'ayuda'
  | 'filtro'
  | 'buscar'
  | 'agregar'
  | 'orden'
  | 'orden-asc'
  | 'orden-desc'
  | 'flecha-abajo'
  | 'operacion'
  | 'pacientes'
  | 'actividades'
  | 'economia'
  | 'configuracion'
  | 'servicios'
  | 'contratacion'
  | 'horarios'
  | 'salir'
  | 'plataforma'
  | 'mas';

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
        @case ('filtro') {
          <path d="M3.5 5h17l-6.5 8v5.5l-4 2V13z" />
        }
        @case ('agregar') {
          <path d="M12 5v14M5 12h14" />
        }
        @case ('orden') {
          <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
        }
        @case ('orden-asc') {
          <path d="M8 14l4-4 4 4" />
        }
        @case ('orden-desc') {
          <path d="M8 10l4 4 4-4" />
        }
        @case ('buscar') {
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        }
        @case ('flecha-abajo') {
          <path d="M6 9l6 6 6-6" />
        }
        @case ('operacion') {
          <path
            d="M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"
          />
        }
        @case ('pacientes') {
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" />
          <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.5 3.5 5.2" />
        }
        @case ('actividades') {
          <path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12" />
        }
        @case ('economia') {
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" />
        }
        @case ('configuracion') {
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M16 4v4M10 10v4M18 16v4" />
        }
        @case ('servicios') {
          <path d="M4 5h16v4H4zM4 11h16v8H4zM8 15h8" />
        }
        @case ('contratacion') {
          <path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" />
        }
        @case ('horarios') {
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        }
        @case ('correo') {
          <path d="M4 6h16v12H4zM4 7l8 6 8-6" />
        }
        @case ('salir') {
          <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
        }
        @case ('plataforma') {
          <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3z" />
        }
        @case ('mas') {
          <circle cx="5" cy="12" r="1.4" />
          <circle cx="12" cy="12" r="1.4" />
          <circle cx="19" cy="12" r="1.4" />
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
