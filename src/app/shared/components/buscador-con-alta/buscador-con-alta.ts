import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  forwardRef,
  input,
  output,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { Icono } from '../icono/icono';

let siguienteId = 0;

/** Sin mayusculas ni acentos: "fisioterapia" encuentra "Fisioterapia" y "kinesiologia" a "Kinesiología". */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Campo con buscador sobre una lista de valores conocidos y alta en el lugar (11/11/2026): se escribe,
 * la lista se acota, y si lo escrito no esta aparece "Agregar «…»" como ultima opcion.
 *
 * <p>Patron combobox de WAI-ARIA: el foco queda en el `input`, las flechas recorren la lista
 * (`aria-activedescendant`), Enter elige y Escape cierra. Lo elegido es un texto: el componente no
 * sabe de dominio ni guarda nada en ningun catalogo.
 *
 * <p>Dos usos. Como control de formulario (`formControlName`) guarda un valor, y lo escrito a mano
 * cuenta como valor aunque no se elija de la lista. Con `limpiarAlElegir` sirve para sumar a una
 * lista: emite `elegido` y se vacia.
 */
@Component({
  selector: 'app-buscador-con-alta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [Icono],
  styleUrl: './buscador-con-alta.css',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => BuscadorConAlta), multi: true },
  ],
  host: { class: 'buscador-con-alta' },
  template: `
    <div class="buscador-con-alta__campo">
      <app-icono class="buscador-con-alta__icono" nombre="buscar" />
      <input
        type="text"
        role="combobox"
        autocomplete="off"
        [id]="idCampo()"
        [placeholder]="placeholder()"
        [value]="texto()"
        [disabled]="deshabilitado()"
        [attr.aria-expanded]="abierto()"
        [attr.aria-controls]="idLista"
        [attr.aria-activedescendant]="abierto() && activa() >= 0 ? idLista + '-' + activa() : null"
        aria-autocomplete="list"
        (input)="escribir($any($event.target).value)"
        (focus)="abrir()"
        (blur)="alSalir()"
        (keydown)="tecla($event)"
      />
    </div>
    @if (abierto() && opcionesVisibles().length > 0) {
      <ul class="buscador-con-alta__lista" role="listbox" [id]="idLista">
        @for (opcion of opcionesVisibles(); track opcion.valor; let i = $index) {
          <li
            role="option"
            class="buscador-con-alta__opcion"
            [class.buscador-con-alta__opcion--activa]="i === activa()"
            [class.buscador-con-alta__opcion--nueva]="opcion.nueva"
            [id]="idLista + '-' + i"
            [attr.aria-selected]="i === activa()"
            tabindex="-1"
            (mousedown)="$event.preventDefault()"
            (click)="elegir(opcion.valor)"
            (keydown.enter)="elegir(opcion.valor)"
          >
            @if (opcion.nueva) {
              <app-icono nombre="agregar" /> Agregar «{{ opcion.valor }}»
            } @else {
              {{ opcion.valor }}
            }
          </li>
        }
      </ul>
    }
  `,
})
export class BuscadorConAlta implements ControlValueAccessor {
  /** Los valores conocidos, en el orden en que se ofrecen. */
  readonly opciones = input<readonly string[]>([]);
  /** El `id` del `input`, para que el `label for` de la pantalla lo nombre. */
  readonly idCampo = input.required<string>();
  readonly placeholder = input('');
  /** Para sumar a una lista: al elegir emite `elegido` y vuelve a quedar vacio. */
  readonly limpiarAlElegir = input(false, { transform: booleanAttribute });
  /** Valores que ya estan elegidos en otro lado y no se ofrecen de nuevo. */
  readonly excluir = input<readonly string[]>([]);

  readonly elegido = output<string>();

  protected readonly idLista = `buscador-con-alta-${siguienteId++}`;
  protected readonly texto = signal('');
  protected readonly abierto = signal(false);
  protected readonly activa = signal(-1);
  protected readonly deshabilitado = signal(false);

  /** Hasta ocho coincidencias y, si lo escrito no esta, la opcion de agregarlo. */
  protected readonly opcionesVisibles = computed(() => {
    const buscado = normalizar(this.texto());
    const excluidos = new Set(this.excluir().map(normalizar));
    const disponibles = this.opciones().filter((opcion) => !excluidos.has(normalizar(opcion)));
    const coincidencias = disponibles
      .filter((opcion) => buscado === '' || normalizar(opcion).includes(buscado))
      .slice(0, 8)
      .map((valor) => ({ valor, nueva: false }));
    const existe =
      buscado === '' ||
      excluidos.has(buscado) ||
      disponibles.some((opcion) => normalizar(opcion) === buscado);
    return existe ? coincidencias : [...coincidencias, { valor: this.texto().trim(), nueva: true }];
  });

  private alCambiar: (valor: string) => void = () => undefined;
  private alTocar: () => void = () => undefined;

  protected escribir(texto: string): void {
    this.texto.set(texto);
    this.abierto.set(true);
    this.activa.set(-1);
    if (!this.limpiarAlElegir()) {
      this.alCambiar(texto.trim());
    }
  }

  protected abrir(): void {
    this.abierto.set(true);
  }

  protected alSalir(): void {
    this.abierto.set(false);
    this.activa.set(-1);
    this.alTocar();
  }

  protected tecla(evento: KeyboardEvent): void {
    const total = this.opcionesVisibles().length;
    switch (evento.key) {
      case 'ArrowDown':
        evento.preventDefault();
        this.abierto.set(true);
        this.activa.update((i) => (total === 0 ? -1 : (i + 1) % total));
        break;
      case 'ArrowUp':
        evento.preventDefault();
        this.activa.update((i) => (total === 0 ? -1 : (i - 1 + total) % total));
        break;
      case 'Enter': {
        const opcion = this.opcionesVisibles()[this.activa()];
        if (opcion !== undefined || (this.limpiarAlElegir() && this.texto().trim() !== '')) {
          // Enter no envia el formulario: elige.
          evento.preventDefault();
          this.elegir(opcion?.valor ?? this.texto().trim());
        }
        break;
      }
      case 'Escape':
        if (this.abierto()) {
          evento.preventDefault();
          this.abierto.set(false);
        }
        break;
    }
  }

  protected elegir(valor: string): void {
    this.elegido.emit(valor);
    this.abierto.set(false);
    this.activa.set(-1);
    if (this.limpiarAlElegir()) {
      this.texto.set('');
    } else {
      this.texto.set(valor);
      this.alCambiar(valor);
    }
  }

  writeValue(valor: string | null): void {
    this.texto.set(valor ?? '');
  }

  registerOnChange(fn: (valor: string) => void): void {
    this.alCambiar = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.alTocar = fn;
  }

  setDisabledState(deshabilitado: boolean): void {
    this.deshabilitado.set(deshabilitado);
  }
}
