import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  HostListener,
  afterRenderEffect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

import { Icono } from '../icono/icono';

let siguienteId = 0;

/** Entre el boton y el panel: `--esp-2`. */
const SEPARACION_PX = 4;

/** Distancia minima del panel a los bordes de la ventana. */
const MARGEN_PX = 8;

/**
 * Si el navegador tiene la API de popover. Sin ella el atributo `popover` no se pone: jsdom no la
 * implementa pero su hoja base igual esconde todo `[popover]` cerrado, y el panel nunca se veia.
 */
const HAY_POPOVER = typeof HTMLElement.prototype.showPopover === 'function';

/**
 * Acciones de una fila de tabla: la principal a la vista y el resto detras de un boton "⋯".
 *
 * <p><b>Por que existe.</b> Filas como las de Ofertas de la sede llevaban seis botones apilados
 * (hallazgo A1 de la auditoria heuristica): la columna de acciones era la mas ancha de la tabla
 * y la accion frecuente se perdia entre las raras. Decidido el 22/10/2026: el menu se usa en filas
 * desde **dos** acciones: una visible (la frecuente) y el resto, con las destructivas, en el menu
 * (UX-11, 28/10/2026).
 *
 * <p><b>Uso.</b> La accion visible va con el atributo `principal`; todo lo demas que se proyecta
 * va al menu:
 *
 * <pre>
 * &lt;app-acciones-de-fila [de]="oferta.nombre"&gt;
 *   &lt;a principal class="accion-texto" ...&gt;Editar&lt;/a&gt;
 *   &lt;button type="button" (click)="..."&gt;Dar de baja&lt;/button&gt;
 * &lt;/app-acciones-de-fila&gt;
 * </pre>
 *
 * <p><b>Divulgacion, no `role="menu"`.</b> Como el "?" (`app-ayuda`): el boton lleva
 * `aria-expanded` y `aria-controls`, y las acciones siguen al boton en el orden del Tab. Un
 * `role="menu"` promete flechas, Home/End y foco manejado, y prometerlo sin cumplirlo es peor que
 * no prometerlo. Escape cierra y devuelve el foco al boton; un clic afuera o en una accion cierra.
 *
 * <p><b>Las acciones estan siempre en el DOM</b>, escondidas con `hidden`: los nombres accesibles
 * no cambian, y un test las encuentra abriendo el menu (`abrirAcciones` en `e2e/support`).
 *
 * <p><b>El panel se abre en la capa superior del navegador</b> (`popover="manual"`), ubicado contra
 * el boton en coordenadas de la ventana. Colgado de la celda con `position: absolute`, lo recortaba
 * el `overflow-x: auto` de `.tabla-scroll` (que fuerza tambien el vertical): en la ultima fila de
 * cualquier tabla las acciones quedaban afuera y no se podian clickear. Sigue en su lugar del DOM,
 * asi que el orden del Tab y el "clic adentro" no cambian. `manual` y no `auto`: el cierre ya lo
 * manejan Escape y el clic afuera de abajo, con la devolucion del foco que el navegador no hace.
 *
 * <p><b>No sabe de dominio.</b> Recibe el nombre de la fila y proyecta los controles.
 */
@Component({
  selector: 'app-acciones-de-fila',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Sin encapsulacion: las acciones son contenido proyectado y el estilo tiene que alcanzarlas.
  // Vive con el componente y no en design-system.css para no pesar en la carga inicial.
  encapsulation: ViewEncapsulation.None,
  styleUrl: './acciones-de-fila.css',
  imports: [Icono],
  template: `
    <ng-content select="[principal]" />
    <button
      #boton
      type="button"
      class="acciones-de-fila__boton"
      [attr.aria-expanded]="abierta()"
      [attr.aria-controls]="idPanel"
      (click)="alternar()"
    >
      <app-icono nombre="mas" />
      <span class="visualmente-oculto">Más acciones de {{ de() }}</span>
    </button>
    <div
      #panel
      class="acciones-de-fila__panel"
      [attr.popover]="hayPopover ? 'manual' : null"
      [id]="idPanel"
      [hidden]="!abierta()"
    >
      <ng-content />
    </div>
  `,
  host: { class: 'acciones-de-fila' },
})
export class AccionesDeFila {
  private readonly elemento = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly boton = viewChild.required<ElementRef<HTMLButtonElement>>('boton');
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  /** De que es la fila, para el nombre del boton: "Más acciones de Kinesio adultos". */
  readonly de = input.required<string>();

  protected readonly abierta = signal(false);

  protected readonly idPanel = `acciones-de-fila-${siguienteId++}`;

  protected readonly hayPopover = HAY_POPOVER;

  constructor() {
    // Abierto, el panel va a la capa superior y sigue al boton si la pagina o la tabla se
    // desplazan. Sin la API de popover (jsdom) queda solo el `hidden`.
    afterRenderEffect((alLimpiar) => {
      if (!this.abierta()) {
        return;
      }
      const panel = this.panel().nativeElement;
      if (HAY_POPOVER) {
        panel.showPopover();
      }
      const ubicar = (): void => this.ubicar(panel);
      // Si el desplazamiento esconde el boton (la tabla corrida de costado, la pagina hacia
      // arriba), el panel cerraria colgado de nada: se cierra.
      const alDesplazar = (): void => {
        if (this.botonALaVista()) {
          ubicar();
        } else {
          this.abierta.set(false);
        }
      };
      ubicar();
      addEventListener('scroll', alDesplazar, { capture: true, passive: true });
      addEventListener('resize', ubicar, { passive: true });
      alLimpiar(() => {
        removeEventListener('scroll', alDesplazar, { capture: true });
        removeEventListener('resize', ubicar);
        if (HAY_POPOVER && panel.matches(':popover-open')) {
          panel.hidePopover();
        }
      });
    });
  }

  /**
   * Debajo del boton y alineado a su borde derecho; arriba si abajo no entra en la ventana. Nunca
   * se sale por los costados: en un telefono el boton puede estar mas cerca del borde izquierdo
   * que el ancho del panel.
   */
  private ubicar(panel: HTMLElement): void {
    const boton = this.boton().nativeElement.getBoundingClientRect();
    const { offsetWidth: ancho, offsetHeight: alto } = panel;
    const debajo = boton.bottom + SEPARACION_PX;
    const encima = boton.top - SEPARACION_PX - alto;
    const entraDebajo = debajo + alto <= innerHeight - MARGEN_PX;
    const maximoIzquierda = document.documentElement.clientWidth - ancho - MARGEN_PX;
    panel.style.top = `${entraDebajo || encima < MARGEN_PX ? debajo : encima}px`;
    panel.style.left = `${Math.max(MARGEN_PX, Math.min(boton.right - ancho, maximoIzquierda))}px`;
  }

  /** Si el centro del boton se ve: no lo recorta la tabla ni lo tapa otra cosa. */
  private botonALaVista(): boolean {
    const boton = this.boton().nativeElement;
    const { left, top, width, height } = boton.getBoundingClientRect();
    const visible = document.elementFromPoint(left + width / 2, top + height / 2);
    return visible !== null && boton.contains(visible);
  }

  protected alternar(): void {
    this.abierta.update((valor) => !valor);
  }

  @HostListener('document:keydown.escape')
  protected cerrarConEscape(): void {
    if (!this.abierta()) {
      return;
    }
    this.abierta.set(false);
    this.elemento.nativeElement
      .querySelector<HTMLButtonElement>('.acciones-de-fila__boton')
      ?.focus();
  }

  /** Un clic afuera cierra; adentro, solo si eligio una accion del panel (no el fondo). */
  @HostListener('document:click', ['$event'])
  protected cerrarSiCorresponde(evento: MouseEvent): void {
    if (!this.abierta()) {
      return;
    }
    const destino = evento.target as HTMLElement;
    const raiz = this.elemento.nativeElement;
    if (!raiz.contains(destino)) {
      this.abierta.set(false);
      return;
    }
    const panel = raiz.querySelector('.acciones-de-fila__panel');
    const accion = destino.closest('button, a');
    if (panel !== null && accion !== null && panel.contains(accion)) {
      this.abierta.set(false);
      // La accion elegida queda escondida: si el foco estaba en ella, pasa al boton "⋯" en vez
      // de perderse en el documento. Una accion que abre un formulario lo enfoca despues del
      // render, asi que este foco no le gana.
      if (panel.contains(document.activeElement)) {
        raiz.querySelector<HTMLButtonElement>('.acciones-de-fila__boton')?.focus();
      }
    }
  }
}
