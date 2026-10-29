import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewEncapsulation,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';

import { Icono } from '../icono/icono';

let siguienteId = 0;

/** Lo primero que recibe el foco al abrir: el primer campo, no el boton de cerrar. */
const PRIMER_CAMPO =
  'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)';

/**
 * Panel lateral (drawer) para editar o confirmar algo sin salir del listado (refactor UX/UI del
 * 28/10/2026).
 *
 * <p><b>Por que existe.</b> Las pantallas de configuracion abrian el formulario de edicion en una
 * fila de la tabla (`tr.fila-panel`): la tabla se partia en dos, el formulario quedaba en una
 * columna interminable a todo el ancho y el pie del listado se iba 1.000 px para abajo. El panel
 * lateral deja la tabla quieta a la izquierda —se sigue viendo que fila se esta editando— y le da
 * al formulario un ancho de lectura con su barra de acciones siempre a la vista.
 *
 * <p><b>Es un `dialog` modal nativo.</b> `showModal()` pone el panel en la capa superior, hace
 * inerte el resto de la pagina y atrapa el foco sin una linea de JavaScript propio. Escape dispara
 * `cancel`, que se convierte en {@link cerrar}: quien abrio el panel decide (lo cierra con su
 * `@if`). El fondo no cierra el panel: un clic afuera no puede descartar un formulario a medio
 * cargar (regla de modales de AKINE).
 *
 * <p><b>El foco vuelve a donde estaba.</b> El panel se destruye con el `@if` de la pantalla, no se
 * "cierra": el navegador no restaura el foco de un `dialog` que se saca del DOM. Se guarda el
 * elemento enfocado al abrir y se le devuelve el foco al destruir, si sigue en la pagina.
 *
 * <p><b>No sabe de dominio.</b> Recibe un titulo y proyecta el contenido. Un formulario proyectado
 * deja su `.acciones` final pegada al pie del panel (CSS).
 */
@Component({
  selector: 'app-panel-lateral',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [Icono],
  styleUrl: './panel-lateral.css',
  template: `
    <dialog
      #dialogo
      class="panel-lateral"
      [class.panel-lateral--amplio]="ancho() === 'amplio'"
      [attr.aria-labelledby]="idTitulo"
      (cancel)="alCancelar($event)"
    >
      <div class="panel-lateral__cabecera">
        <div class="panel-lateral__titulos">
          <h2 class="panel-lateral__titulo" [id]="idTitulo">{{ titulo() }}</h2>
          @if (subtitulo(); as texto) {
            <p class="panel-lateral__subtitulo">{{ texto }}</p>
          }
        </div>
        <button type="button" class="panel-lateral__cerrar" (click)="cerrar.emit()">
          <app-icono nombre="cerrar" />
          <span class="visualmente-oculto">Cerrar el panel</span>
        </button>
      </div>
      <div class="panel-lateral__cuerpo">
        <ng-content />
      </div>
    </dialog>
  `,
})
export class PanelLateral implements OnDestroy {
  private readonly documento = inject(DOCUMENT);
  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');

  /** Lo que se esta haciendo, con el nombre de la entidad: "Editar Centro Norte". */
  readonly titulo = input.required<string>();

  /** Una linea de contexto opcional bajo el titulo. */
  readonly subtitulo = input<string | null>(null);

  /** `amplio` para formularios con tablas o grillas de varias columnas. */
  readonly ancho = input<'normal' | 'amplio'>('normal');

  /** El usuario pidio cerrar: boton de cerrar o Escape. */
  readonly cerrar = output<void>();

  protected readonly idTitulo = `panel-lateral-${siguienteId++}-titulo`;

  private readonly enfocadoAlAbrir: HTMLElement | null;

  constructor() {
    const activo = this.documento.activeElement;
    this.enfocadoAlAbrir = activo instanceof HTMLElement ? activo : null;

    afterNextRender(() => {
      const dialogo = this.dialogo().nativeElement;
      // jsdom no implementa `showModal`: ahi queda abierto como dialogo no modal.
      if (typeof dialogo.showModal === 'function' && !dialogo.open) {
        dialogo.showModal();
      } else {
        dialogo.setAttribute('open', '');
      }
      const campo = dialogo.querySelector<HTMLElement>(`.panel-lateral__cuerpo ${PRIMER_CAMPO}`);
      (campo ?? dialogo.querySelector<HTMLElement>('.panel-lateral__cerrar'))?.focus();
    });
  }

  protected alCancelar(evento: Event): void {
    // Escape: el panel no se cierra solo; lo cierra quien lo abrio, quitandolo del DOM.
    evento.preventDefault();
    this.cerrar.emit();
  }

  ngOnDestroy(): void {
    const destino = this.enfocadoAlAbrir;
    if (destino !== null && destino.isConnected) {
      // En un microtask: el `dialog` todavia esta en el DOM y haciendo inerte el resto.
      queueMicrotask(() => destino.focus());
    }
  }
}
