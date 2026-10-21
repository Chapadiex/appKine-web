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
 * informacion, no una decision. Escape lo cierra y devuelve el foco al boton; un clic afuera lo
 * cierra sin moverlo.
 *
 * <p><b>El contenido esta siempre en el DOM</b>, escondido con `hidden` mientras el panel esta
 * cerrado: la pantalla sigue diciendo lo mismo para quien la lee entera (y para los specs que
 * miran su texto), y abrir no cuesta un render.
 *
 * <p><b>No sabe de dominio.</b> Recibe un titulo y proyecta el contenido.
 */
@Component({
  selector: 'akine-ayuda, app-ayuda',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
      <span class="visualmente-oculto">Que significa: {{ titulo() }}</span>
    </button>
    <div
      class="ayuda-contextual__panel"
      [id]="idPanel"
      [hidden]="!abierta()"
      [attr.aria-labelledby]="idTitulo"
      role="region"
    >
      <p class="ayuda-contextual__titulo" [id]="idTitulo">{{ titulo() }}</p>
      <ng-content />
    </div>
  `,
  host: { class: 'ayuda-contextual' },
})
export class Ayuda {
  private readonly elemento = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Lo que explica la ayuda, en una frase: "Persona y paciente no son lo mismo". */
  readonly titulo = input.required<string>();

  protected readonly abierta = signal(false);

  private readonly id = siguienteId++;
  protected readonly idPanel = `ayuda-${this.id}`;
  protected readonly idTitulo = `ayuda-${this.id}-titulo`;

  protected alternar(): void {
    this.abierta.update((valor) => !valor);
  }

  @HostListener('document:keydown.escape')
  protected cerrarConEscape(): void {
    if (!this.abierta()) {
      return;
    }
    this.abierta.set(false);
    this.elemento.nativeElement.querySelector<HTMLButtonElement>('button')?.focus();
  }

  @HostListener('document:click', ['$event'])
  protected cerrarSiEsAfuera(evento: MouseEvent): void {
    if (this.abierta() && !this.elemento.nativeElement.contains(evento.target as Node)) {
      this.abierta.set(false);
    }
  }
}
