import {
  Directive,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';

/**
 * Comportamiento de los dos desplegables de la barra superior: el selector de sede y el menu del
 * perfil (refactor de la cabecera global, 28/10/2026).
 *
 * <p>Un boton con `aria-expanded` abre un panel `.desplegable`; el foco entra al primer elemento
 * operable del panel, las flechas recorren los items y Escape cierra y devuelve el foco al boton.
 * Un clic fuera del componente cierra sin mover el foco: el usuario ya eligio donde ponerlo.
 *
 * <p>No es un `role="menu"`: los items son enlaces y botones comunes, que el lector anuncia como
 * tales y se activan con Enter. El patron de menu de ARIA promete un manejo de teclado completo
 * (letras, Home/End, submenus) que estos paneles de cuatro items no necesitan.
 */
@Directive()
export abstract class Desplegable {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly abierto = signal(false);

  protected alternar(): void {
    if (this.abierto()) {
      this.cerrar();
      return;
    }
    this.abierto.set(true);
    // El panel recien existe despues del proximo render: enfocar antes no hace nada.
    afterNextRender(() => this.enfocables()[0]?.focus(), { injector: this.injector });
  }

  protected cerrar(devolverFoco = false): void {
    if (!this.abierto()) {
      return;
    }
    this.abierto.set(false);
    if (devolverFoco) {
      this.host.nativeElement.querySelector<HTMLElement>('[aria-expanded]')?.focus();
    }
  }

  @HostListener('document:click', ['$event'])
  protected alHacerClic(evento: MouseEvent): void {
    if (this.abierto() && !this.host.nativeElement.contains(evento.target as Node)) {
      this.cerrar();
    }
  }

  @HostListener('keydown', ['$event'])
  protected alTeclear(evento: KeyboardEvent): void {
    if (!this.abierto()) {
      return;
    }
    if (evento.key === 'Escape') {
      this.cerrar(true);
      return;
    }
    if (evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp') {
      return;
    }
    const items = this.enfocables();
    if (items.length === 0) {
      return;
    }
    evento.preventDefault();
    const actual = items.indexOf(
      this.host.nativeElement.ownerDocument.activeElement as HTMLElement,
    );
    const siguiente =
      evento.key === 'ArrowDown'
        ? (actual + 1) % items.length
        : (actual <= 0 ? items.length : actual) - 1;
    items[siguiente]!.focus();
  }

  private enfocables(): HTMLElement[] {
    return [
      ...this.host.nativeElement.querySelectorAll<HTMLElement>(
        '.desplegable input, .desplegable .desplegable__item:not(:disabled)',
      ),
    ];
  }
}
