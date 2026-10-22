import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  input,
  signal,
} from '@angular/core';

import { Icono } from '../icono/icono';

let siguienteId = 0;

/**
 * Acciones de una fila de tabla: la principal a la vista y el resto detras de un boton "⋯".
 *
 * <p><b>Por que existe.</b> Filas como las de Ofertas de la sede llevaban seis botones apilados
 * (hallazgo A1 de la auditoria heuristica): la columna de acciones era la mas ancha de la tabla
 * y la accion frecuente se perdia entre las raras. Decidido el 22/10/2026: el menu se usa en filas
 * con **tres o mas** acciones; con una o dos, los botones siguen sueltos.
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
 * <p><b>No sabe de dominio.</b> Recibe el nombre de la fila y proyecta los controles.
 */
@Component({
  selector: 'app-acciones-de-fila',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icono],
  template: `
    <ng-content select="[principal]" />
    <button
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
      class="acciones-de-fila__panel"
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

  /** De que es la fila, para el nombre del boton: "Más acciones de Kinesio adultos". */
  readonly de = input.required<string>();

  protected readonly abierta = signal(false);

  protected readonly idPanel = `acciones-de-fila-${siguienteId++}`;

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
    }
  }
}
