import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewEncapsulation,
  afterRenderEffect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

import { Icono } from '../icono/icono';
import { posicionFlotante } from '../../utils/posicion-flotante';

let siguienteId = 0;

/**
 * Si el navegador tiene la API de popover. Sin ella el atributo `popover` no se pone: jsdom no la
 * implementa pero su hoja base igual esconde todo `[popover]` cerrado (ver `AccionesDeFila`).
 */
const HAY_POPOVER = typeof HTMLElement.prototype.showPopover === 'function';

/**
 * Ayuda contextual de una pantalla (UX-01): un boton "?" al lado del titulo que despliega la
 * explicacion del modelo en un panel.
 *
 * <p><b>Por que existe.</b> Las pantallas abrian con una "nota clave" de tres parrafos —"Persona y
 * paciente no son lo mismo", "Activa y vigente hoy no son lo mismo"— que se lee una vez y se paga
 * en cada uso: el primer dato util aparecia a 1.000 px del borde. El texto no se borra: codifica
 * reglas que la pantalla tiene que poder explicar. Se pliega detras de un clic (plan §3.2).
 *
 * <p><b>Patron de divulgacion, no de dialogo.</b> El boton lleva `aria-expanded` y `aria-controls`,
 * y el panel sigue al boton en el orden del Tab. No atrapa el foco ni oscurece la pagina: es
 * informacion, no una decision. Escape o la cruz lo cierran y devuelven el foco al boton; un clic
 * afuera lo cierra sin moverlo.
 *
 * <p><b>El panel se abre en la capa superior del navegador</b> (`popover="manual"`), ubicado contra
 * el boton en coordenadas de la ventana (28/10/2026). Colgado del boton con `position: absolute`,
 * se abria siempre hacia el mismo lado y lo cortaba el borde de la ventana o el `overflow` de un
 * contenedor: en "Nueva persona", dentro del panel lateral, quedaba afuera de la pantalla. Un
 * `z-index` no arregla un recorte. Tampoco CDK Overlay: cuelga el panel del `body`, que con un
 * panel lateral abierto (un `dialog` modal) es inerte y queda debajo. Un popover abierto despues
 * del `dialog` va encima en la misma capa, y sigue siendo descendiente suyo para el foco.
 *
 * <p><b>La pantalla no elige el lado.</b> {@link posicionFlotante} prueba derecha, izquierda,
 * abajo y arriba, corre el panel para que no toque los bordes y lo acota si no entra en ningun
 * lado (el titulo queda fijo y el texto se desplaza). Se recalcula con el scroll, con la ventana y
 * con el tamaño del panel lateral; si el boton sale de la ventana, el panel se cierra.
 *
 * <p><b>El contenido esta siempre en el DOM</b>, escondido con `hidden` mientras el panel esta
 * cerrado: la pantalla sigue diciendo lo mismo para quien la lee entera (y para los specs que
 * miran su texto), y abrir no cuesta un render.
 *
 * <p><b>No sabe de dominio.</b> Recibe un titulo, opcionalmente un tamaño, y proyecta el contenido.
 */
@Component({
  selector: 'akine-ayuda, app-ayuda',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Los estilos alcanzan al contenido proyectado (los `p` y `ul` de cada pantalla).
  encapsulation: ViewEncapsulation.None,
  styleUrl: './ayuda.css',
  imports: [Icono],
  template: `
    <button
      #boton
      type="button"
      class="ayuda-contextual__boton"
      [attr.aria-expanded]="abierta()"
      [attr.aria-controls]="idPanel"
      (click)="alternar()"
    >
      <app-icono nombre="ayuda" />
      <span class="visualmente-oculto">Ayuda: {{ titulo() }}</span>
    </button>
    <div
      #panel
      class="ayuda-contextual__panel"
      [class.ayuda-contextual__panel--amplio]="tamano() === 'amplio'"
      [attr.popover]="hayPopover ? 'manual' : null"
      [id]="idPanel"
      [hidden]="!abierta()"
      [attr.aria-labelledby]="idTitulo"
      role="region"
    >
      <div class="ayuda-contextual__cabecera">
        <p class="ayuda-contextual__titulo" [id]="idTitulo">{{ titulo() }}</p>
        <button type="button" class="ayuda-contextual__cerrar" (click)="cerrar()">
          <app-icono nombre="cerrar" />
          <span class="visualmente-oculto">Cerrar la ayuda</span>
        </button>
      </div>
      <div #cuerpo class="ayuda-contextual__cuerpo">
        <ng-content />
      </div>
    </div>
  `,
  host: { class: 'ayuda-contextual' },
})
export class Ayuda {
  private readonly elemento = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly boton = viewChild.required<ElementRef<HTMLButtonElement>>('boton');
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly cuerpo = viewChild.required<ElementRef<HTMLElement>>('cuerpo');

  /** Lo que explica la ayuda, en una frase: "Persona y paciente no son lo mismo". */
  readonly titulo = input.required<string>();

  /** `amplio` para explicaciones con listas o tablas; nunca pasa del ancho de la ventana. */
  readonly tamano = input<'normal' | 'amplio'>('normal');

  protected readonly abierta = signal(false);

  private readonly id = siguienteId++;
  protected readonly idPanel = `ayuda-${this.id}`;
  protected readonly idTitulo = `ayuda-${this.id}-titulo`;

  protected readonly hayPopover = HAY_POPOVER;

  constructor() {
    afterRenderEffect((alLimpiar) => {
      if (!this.abierta()) {
        return;
      }
      const panel = this.panel().nativeElement;
      if (HAY_POPOVER) {
        panel.showPopover();
      }
      const ubicar = (): void => this.ubicar(panel);
      // Si el desplazamiento saca el boton de la ventana, el panel quedaria colgado de nada.
      const alDesplazar = (): void => {
        if (this.botonEnLaVentana()) {
          ubicar();
        } else {
          this.abierta.set(false);
        }
      };
      ubicar();
      addEventListener('scroll', alDesplazar, { capture: true, passive: true });
      addEventListener('resize', ubicar, { passive: true });
      // El panel lateral cambia de ancho sin que cambie la ventana (y el boton se mueve con el).
      const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(ubicar) : null;
      observador?.observe(this.elemento.nativeElement.closest('dialog') ?? document.body);
      alLimpiar(() => {
        removeEventListener('scroll', alDesplazar, { capture: true });
        removeEventListener('resize', ubicar);
        observador?.disconnect();
        if (HAY_POPOVER && panel.matches(':popover-open')) {
          panel.hidePopover();
        }
      });
    });
  }

  private ubicar(panel: HTMLElement): void {
    // Se mide el tamaño natural: el alto acotado de la vez anterior puede no hacer falta ahora.
    panel.style.maxHeight = '';
    const ventana = document.documentElement;
    const posicion = posicionFlotante(
      this.boton().nativeElement.getBoundingClientRect(),
      panel.offsetWidth,
      panel.offsetHeight,
      { ancho: ventana.clientWidth, alto: ventana.clientHeight },
    );
    panel.dataset['lado'] = posicion.lado;
    panel.style.top = `${posicion.top}px`;
    panel.style.left = `${posicion.left}px`;
    panel.style.maxHeight = posicion.altoMaximo === null ? '' : `${posicion.altoMaximo}px`;
    panel.style.setProperty('--flecha', `${posicion.flecha}px`);
    // Un texto que se desplaza tiene que poder desplazarse con el teclado.
    const cuerpo = this.cuerpo().nativeElement;
    if (cuerpo.scrollHeight > cuerpo.clientHeight) {
      cuerpo.setAttribute('tabindex', '0');
    } else {
      cuerpo.removeAttribute('tabindex');
    }
  }

  private botonEnLaVentana(): boolean {
    const { top, bottom, left, right } = this.boton().nativeElement.getBoundingClientRect();
    const ventana = document.documentElement;
    return bottom > 0 && right > 0 && top < ventana.clientHeight && left < ventana.clientWidth;
  }

  protected alternar(): void {
    this.abierta.update((valor) => !valor);
  }

  protected cerrar(): void {
    this.abierta.set(false);
    this.boton().nativeElement.focus();
  }

  /**
   * Escape cierra la ayuda y nada mas: adentro de un panel lateral, el mismo Escape cerraria el
   * `dialog` (su `cancel`). Cancelar la tecla evita ese pedido de cierre.
   */
  @HostListener('document:keydown.escape', ['$event'])
  protected cerrarConEscape(evento: Event): void {
    if (!this.abierta()) {
      return;
    }
    evento.preventDefault();
    this.cerrar();
  }

  @HostListener('document:click', ['$event'])
  protected cerrarSiEsAfuera(evento: MouseEvent): void {
    if (this.abierta() && !this.elemento.nativeElement.contains(evento.target as Node)) {
      this.abierta.set(false);
    }
  }
}
