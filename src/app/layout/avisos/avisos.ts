import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  inject,
} from '@angular/core';

import { AvisosStore, TipoDeAviso } from '../../core/services/avisos.store';
import { Icono } from '../../shared/components/icono/icono';

const HAY_POPOVER = typeof HTMLElement.prototype.showPopover === 'function';

/** Lo que un lector de pantalla oye antes del titulo: el color no le llega. */
const PREFIJO: Readonly<Record<TipoDeAviso, string>> = {
  exito: 'Listo:',
  info: 'Aviso:',
  advertencia: 'Atención:',
  error: 'Error:',
};

/**
 * Avisos globales ("toasts"), arriba a la derecha y debajo de la barra superior.
 *
 * <p><b>Arriba y no abajo.</b> Los formularios largos y los paneles laterales tienen la barra de
 * acciones pegada al pie: un aviso abajo la taparia, o quedaria tapado por ella.
 *
 * <p><b>Capa superior.</b> El contenedor es un `popover="manual"`: vive en la capa superior, por
 * encima de la pagina. Un panel lateral (`dialog` modal) que se abre despues lo taparia, asi que
 * cada aviso nuevo vuelve a mostrar el contenedor y lo deja otra vez arriba de todo.
 *
 * <p><b>Accesible.</b> Cada aviso dice su severidad con icono y con texto (oculto para la vista,
 * leido por el lector), no solo con color. El contenedor existe antes del primer aviso: los exitos
 * e informaciones se anuncian por su region `polite`; las advertencias y los errores, con
 * `role="alert"`. Pasar el puntero o el foco pausa el cierre automatico.
 */
@Component({
  selector: 'app-avisos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icono],
  styleUrl: './avisos.css',
  host: {
    class: 'avisos',
    '[attr.popover]': 'hayPopover ? "manual" : null',
    'aria-label': 'Notificaciones',
    role: 'region',
  },
  template: `
    <div class="avisos__lista" aria-live="polite">
      @for (aviso of store.avisos(); track aviso.id) {
        <div
          class="aviso aviso--{{ aviso.tipo }}"
          [attr.role]="aviso.tipo === 'error' || aviso.tipo === 'advertencia' ? 'alert' : null"
          (mouseenter)="store.pausar(aviso.id)"
          (mouseleave)="store.reanudar(aviso.id)"
          (focusin)="store.pausar(aviso.id)"
          (focusout)="store.reanudar(aviso.id)"
        >
          <app-icono class="aviso__icono" [nombre]="aviso.tipo" />
          <div class="aviso__textos">
            <p class="aviso__titulo">
              <span class="visualmente-oculto">{{ prefijo[aviso.tipo] }}</span>
              {{ aviso.titulo }}
            </p>
            @if (aviso.descripcion; as descripcion) {
              <p class="aviso__descripcion">{{ descripcion }}</p>
            }
            @if (aviso.accion; as accion) {
              <button type="button" class="aviso__accion" (click)="store.ejecutar(aviso.id)">
                {{ accion.etiqueta }}
              </button>
            }
          </div>
          <button type="button" class="aviso__cerrar" (click)="store.cerrar(aviso.id)">
            <app-icono nombre="cerrar" />
            <span class="visualmente-oculto">Cerrar el aviso</span>
          </button>
        </div>
      }
    </div>
  `,
})
export class Avisos {
  protected readonly store = inject(AvisosStore);
  protected readonly hayPopover = HAY_POPOVER;
  protected readonly prefijo = PREFIJO;
  private readonly elemento = inject<ElementRef<HTMLElement>>(ElementRef);
  private ultimo = 0;

  constructor() {
    // Cada aviso nuevo vuelve a poner el contenedor arriba de la capa superior (por encima de un
    // panel lateral abierto despues). Sin avisos se oculta: un popover vacio no tapa nada, pero
    // tampoco tiene por que estar.
    afterRenderEffect(() => {
      const avisos = this.store.avisos();
      if (!HAY_POPOVER) {
        return;
      }
      const host = this.elemento.nativeElement;
      const nuevo = avisos.at(-1)?.id ?? 0;
      if (avisos.length === 0) {
        if (host.matches(':popover-open')) {
          host.hidePopover();
        }
      } else if (nuevo !== this.ultimo || !host.matches(':popover-open')) {
        if (host.matches(':popover-open')) {
          host.hidePopover();
        }
        host.showPopover();
      }
      this.ultimo = nuevo;
    });
  }
}
