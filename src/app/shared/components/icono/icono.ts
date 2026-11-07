import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Circulo como trazo: el mismo recorrido que el `<circle>` de SVG (dos arcos y cierre). */
function circulo(cx: number, cy: number, r: number): string {
  return `M${cx + r} ${cy}a${r} ${r} 0 1 1-${2 * r} 0a${r} ${r} 0 1 1 ${2 * r} 0z`;
}

/** Rectangulo de esquinas redondeadas como trazo: el mismo recorrido que el `<rect rx>` de SVG. */
function rectangulo(x: number, y: number, ancho: number, alto: number, rx: number): string {
  const a = `a${rx} ${rx} 0 0 1`;
  return (
    `M${x + rx} ${y}h${ancho - 2 * rx}${a} ${rx} ${rx}v${alto - 2 * rx}${a}-${rx} ${rx}` +
    `h-${ancho - 2 * rx}${a}-${rx}-${rx}v-${alto - 2 * rx}${a} ${rx}-${rx}z`
  );
}

const ANILLO = circulo(12, 12, 9.5);

/**
 * El trazo de cada icono, en un solo `d`. Varios subtrazos en un `<path>` dibujan lo mismo que
 * varios elementos sueltos: el icono es solo contorno (`fill: none`) y de un unico color.
 *
 * <p>Antes cada icono era un `@case` de la plantilla, y el compilador emitia una funcion de
 * plantilla por caso: ~7,9 kB del bundle inicial para cuarenta dibujos. Como datos, es una cadena
 * por icono.
 */
const TRAZOS = {
  menu: 'M3 6h18M3 12h18M3 18h18',
  cerrar: 'M6 6l12 12M18 6L6 18',
  ayuda: ANILLO + 'M9.5 9.2a2.6 2.6 0 0 1 5 1c0 1.8-2.5 2.3-2.5 3.8M12 17.2h.01',
  filtro: 'M3.5 5h17l-6.5 8v5.5l-4 2V13z',
  agregar: 'M12 5v14M5 12h14',
  orden: 'M8 9l4-4 4 4M8 15l4 4 4-4',
  'orden-asc': 'M8 14l4-4 4 4',
  'orden-desc': 'M8 10l4 4 4-4',
  buscar: circulo(11, 11, 6.5) + 'M16 16l4.5 4.5',
  'flecha-abajo': 'M6 9l6 6 6-6',
  'chevron-izquierda': 'M15 6l-6 6 6 6',
  'chevron-derecha': 'M9 6l6 6-6 6',
  operacion:
    'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  pacientes:
    circulo(9, 8, 3.5) +
    'M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.5 3.5 5.2',
  actividades: 'M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12',
  economia: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  configuracion: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M16 4v4M10 10v4M18 16v4',
  servicios: 'M4 5h16v4H4zM4 11h16v8H4zM8 15h8',
  contratacion: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  calendario: rectangulo(4, 5, 16, 15, 2) + 'M8 3v4M16 3v4M4 10h16',
  candado: rectangulo(5, 11, 14, 9, 2) + 'M8 11V8a4 4 0 0 1 8 0v3',
  horarios: circulo(12, 12, 9) + 'M12 7v5l3 2',
  correo: 'M4 6h16v12H4zM4 7l8 6 8-6',
  salir: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  plataforma: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3z',
  mas: circulo(5, 12, 1.4) + circulo(12, 12, 1.4) + circulo(19, 12, 1.4),
  sede: 'M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z' + circulo(12, 10, 2.3),
  // Absoluto (`M`): un `m` despues de otro subtrazo seria relativo al punto anterior.
  capas: 'M12 3 21 8l-9 5-9-5 9-5zM3 12l9 5 9-5M3 16l9 5 9-5',
  organizacion:
    circulo(12, 5, 2.5) + circulo(5, 18, 2.5) + circulo(19, 18, 2.5) + 'M10.5 7 6 15.5M13.5 7l4.5 8.5',
  edificio: 'M5 21V4l7-2v19M12 8h7v13M3 21h18M8 6v1M8 11v1M8 16v1M15 11v1M15 16v1',
  perfil: circulo(12, 8, 3.8) + 'M4.5 20.5c.8-4 3.7-6.2 7.5-6.2s6.7 2.2 7.5 6.2',
  preferencias: 'M4 7h9M17 7h3M4 17h3M11 17h9' + circulo(15, 7, 2) + circulo(9, 17, 2),
  tilde: 'M5 12.5l4.5 4.5L19 7.5',
  'flecha-derecha': 'M5 12h14M13 6l6 6-6 6',
  exito: ANILLO + 'M7.8 12.3l2.8 2.8 5.6-5.8',
  info: ANILLO + 'M12 11v5.5M12 7.6h.01',
  advertencia: 'M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.4h.01',
  error: ANILLO + 'M9 9l6 6M15 9l-6 6',
} satisfies Record<string, string>;

/** Los iconos que existen. Agregar uno es agregar su trazo en `TRAZOS`. */
export type NombreDeIcono = keyof typeof TRAZOS;

/**
 * Icono SVG en linea (UX-01, decision §9.3 del plan: sin libreria). Trazos propios de 24 px.
 *
 * <p><b>Decorativo por defecto.</b> `aria-hidden="true"` siempre: el nombre accesible lo pone
 * el boton o el enlace que lo contiene, con texto visible o `aria-label`. Un icono con nombre
 * propio al lado de un texto se lee dos veces.
 *
 * <p><b>Un `[attr.d]` y no `innerHTML`.</b> El trazo es una cadena propia en un atributo: no
 * pasa por el sanitizador, no necesita `bypassSecurityTrust*` y la CSP con nonce lo cubre.
 *
 * <p>Hereda el color del texto (`currentColor`) y el tamano lo decide quien lo usa con `font-size`.
 */
@Component({
  selector: 'akine-icono, app-icono',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path [attr.d]="trazo()" />
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

  protected readonly trazo = computed(() => TRAZOS[this.nombre()]);
}
