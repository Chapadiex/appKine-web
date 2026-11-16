import {
  ApplicationRef,
  ComponentRef,
  DestroyRef,
  Directive,
  ElementRef,
  EnvironmentInjector,
  Injector,
  createComponent,
  effect,
  inject,
} from '@angular/core';

import { BotonDeDictado } from './boton-de-dictado';
import { DictadoStore } from './dictado.store';

/**
 * Pone un micrófono dentro de un `<input>` o `<textarea>`: lo dictado se agrega al final del campo,
 * tal cual, y se dispara `input` como si se hubiera tecleado. Así cada pantalla lo procesa con el
 * manejador que ya tiene.
 *
 * ```html
 * <textarea id="notas" appDictado (input)="notas.set($any($event.target).value)"></textarea>
 * ```
 *
 * <p>Sólo se dibuja con `dictado:use`, una sede elegida, un navegador que pueda grabar (HTTPS) y el
 * dictado prendido en el servidor. Para eso envuelve el campo en un `<span class="dictado">`: el
 * botón se posiciona contra esa envoltura y no contra el contenedor del campo, que también tiene
 * la etiqueta y la ayuda.
 */
@Directive({
  selector: 'input[appDictado], textarea[appDictado]',
})
export class Dictado {
  private readonly campo = inject<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(ElementRef);
  private readonly dictado = inject(DictadoStore);
  private readonly appRef = inject(ApplicationRef);
  private readonly entorno = inject(EnvironmentInjector);
  private readonly injector = inject(Injector);

  private envoltura: HTMLSpanElement | null = null;
  private boton: ComponentRef<BotonDeDictado> | null = null;

  constructor() {
    effect(() => (this.dictado.disponible() ? this.montar() : this.desmontar()));
    inject(DestroyRef).onDestroy(() => this.desmontar());
  }

  private montar(): void {
    if (this.envoltura) {
      return;
    }
    const campo = this.campo.nativeElement;
    const padre = campo.parentNode;
    if (!padre) {
      return;
    }
    const envoltura = campo.ownerDocument.createElement('span');
    envoltura.className = 'dictado';
    if (campo instanceof HTMLTextAreaElement) {
      envoltura.classList.add('dictado--multilinea');
    }
    padre.insertBefore(envoltura, campo);
    envoltura.appendChild(campo);
    campo.classList.add('dictado__campo');

    const boton = createComponent(BotonDeDictado, {
      environmentInjector: this.entorno,
      elementInjector: this.injector,
    });
    boton.setInput('campo', campo);
    this.appRef.attachView(boton.hostView);
    envoltura.appendChild(boton.location.nativeElement);

    this.envoltura = envoltura;
    this.boton = boton;
  }

  private desmontar(): void {
    this.boton?.destroy();
    this.boton = null;
    const envoltura = this.envoltura;
    if (!envoltura) {
      return;
    }
    const campo = this.campo.nativeElement;
    campo.classList.remove('dictado__campo');
    // Si Angular ya sacó el campo (un @if que se cerró), la envoltura quedó sola: se va igual.
    if (campo.parentNode === envoltura) {
      envoltura.parentNode?.insertBefore(campo, envoltura);
    }
    envoltura.remove();
    this.envoltura = null;
  }
}
