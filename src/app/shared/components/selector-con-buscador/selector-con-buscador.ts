import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  forwardRef,
  input,
  output,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { Icono } from '../icono/icono';

/** Una opcion elegible: el valor que se guarda y el texto que se muestra. */
export interface OpcionDeSelector {
  readonly valor: string;
  readonly etiqueta: string;
}

/** Opciones bajo un titulo de grupo (una categoria). */
export interface GrupoDeSelector {
  readonly etiqueta: string;
  readonly opciones: readonly OpcionDeSelector[];
}

let siguienteId = 0;

/** Sin mayusculas ni acentos: "kinesiologia" encuentra "Kinesiología". */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Selector con buscador y grupos: se escribe, la lista se acota, y cada grupo lleva su titulo bien
 * visible (lo que un `optgroup` nativo no garantiza). Elegir guarda el `valor` de la opcion.
 *
 * <p>Patron combobox de WAI-ARIA, igual que {@link BuscadorConAlta}: el foco queda en el `input`,
 * las flechas recorren las opciones (`aria-activedescendant`), Enter elige y Escape cierra. A
 * diferencia de aquel, lo escrito a mano NO es un valor: si se sale sin elegir, el campo vuelve a
 * mostrar lo elegido. No sabe de dominio.
 */
@Component({
  selector: 'app-selector-con-buscador',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [Icono],
  styleUrls: ['../buscador-con-alta/buscador-con-alta.css', './selector-con-buscador.css'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SelectorConBuscador),
      multi: true,
    },
  ],
  host: { class: 'buscador-con-alta selector-con-buscador' },
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
        [attr.aria-invalid]="invalido() ? 'true' : null"
        [attr.aria-describedby]="describedby()"
        [attr.aria-activedescendant]="abierto() && activa() >= 0 ? idLista + '-' + activa() : null"
        aria-autocomplete="list"
        (input)="escribir($any($event.target).value)"
        (focus)="abrir($any($event.target))"
        (click)="abierto.set(true)"
        (blur)="alSalir()"
        (keydown)="tecla($event)"
      />
    </div>
    @if (abierto()) {
      <ul
        class="buscador-con-alta__lista selector-con-buscador__lista"
        role="listbox"
        [id]="idLista"
      >
        @for (grupo of gruposVisibles(); track grupo.etiqueta) {
          <li class="selector-con-buscador__grupo" role="presentation">{{ grupo.etiqueta }}</li>
          @for (opcion of grupo.opciones; track opcion.valor) {
            <li
              role="option"
              class="buscador-con-alta__opcion"
              [class.buscador-con-alta__opcion--activa]="indiceDe(opcion) === activa()"
              [class.selector-con-buscador__opcion--elegida]="opcion.valor === valor()"
              [id]="idLista + '-' + indiceDe(opcion)"
              [attr.aria-selected]="opcion.valor === valor()"
              [attr.data-valor]="opcion.valor"
              tabindex="-1"
              (mousedown)="$event.preventDefault()"
              (click)="elegir(opcion)"
              (keydown.enter)="elegir(opcion)"
            >
              {{ opcion.etiqueta }}
            </li>
          }
        } @empty {
          <li class="selector-con-buscador__vacio" role="presentation">
            No hay coincidencias para «{{ texto() }}».
          </li>
        }
      </ul>
    }
  `,
})
export class SelectorConBuscador implements ControlValueAccessor {
  readonly grupos = input<readonly GrupoDeSelector[]>([]);
  /** El `id` del `input`, para que el `label for` de la pantalla lo nombre. */
  readonly idCampo = input.required<string>();
  readonly placeholder = input('Buscar…');
  readonly invalido = input(false);
  readonly describedby = input<string | null>(null);

  /** El valor elegido, cada vez que se elige. */
  readonly elegido = output<string>();

  protected readonly idLista = `selector-con-buscador-${siguienteId++}`;
  protected readonly texto = signal('');
  protected readonly valor = signal('');
  protected readonly abierto = signal(false);
  protected readonly activa = signal(-1);
  protected readonly deshabilitado = signal(false);
  /** Mientras no se escribe, la lista muestra todo (aunque el campo tenga lo elegido). */
  private readonly filtrando = signal(false);

  protected readonly gruposVisibles = computed(() => {
    const buscado = this.filtrando() ? normalizar(this.texto()) : '';
    return this.grupos()
      .map((grupo) => ({
        etiqueta: grupo.etiqueta,
        opciones: grupo.opciones.filter(
          (opcion) =>
            buscado === '' ||
            normalizar(opcion.etiqueta).includes(buscado) ||
            normalizar(grupo.etiqueta).includes(buscado),
        ),
      }))
      .filter((grupo) => grupo.opciones.length > 0);
  });

  /** Las visibles en orden, para recorrerlas con las flechas. */
  private readonly planas = computed(() => this.gruposVisibles().flatMap((g) => g.opciones));

  private alCambiar: (valor: string) => void = () => undefined;
  private alTocar: () => void = () => undefined;

  protected indiceDe(opcion: OpcionDeSelector): number {
    return this.planas().indexOf(opcion);
  }

  protected escribir(texto: string): void {
    this.texto.set(texto);
    this.filtrando.set(true);
    this.abierto.set(true);
    this.activa.set(this.planas().length > 0 ? 0 : -1);
  }

  protected abrir(campo: HTMLInputElement): void {
    this.abierto.set(true);
    // Con algo elegido, seleccionar el texto deja escribir encima sin borrarlo a mano.
    campo.select();
  }

  protected alSalir(): void {
    this.abierto.set(false);
    this.activa.set(-1);
    this.filtrando.set(false);
    this.texto.set(this.etiquetaDe(this.valor()));
    this.alTocar();
  }

  protected tecla(evento: KeyboardEvent): void {
    const total = this.planas().length;
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
        const opcion = this.planas()[this.activa()];
        if (this.abierto() && opcion !== undefined) {
          // Enter no envia el formulario: elige.
          evento.preventDefault();
          this.elegir(opcion);
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

  protected elegir(opcion: OpcionDeSelector): void {
    this.valor.set(opcion.valor);
    this.texto.set(opcion.etiqueta);
    this.filtrando.set(false);
    this.abierto.set(false);
    this.activa.set(-1);
    this.alCambiar(opcion.valor);
    this.elegido.emit(opcion.valor);
  }

  private etiquetaDe(valor: string): string {
    for (const grupo of this.grupos()) {
      const opcion = grupo.opciones.find((o) => o.valor === valor);
      if (opcion !== undefined) {
        return opcion.etiqueta;
      }
    }
    return '';
  }

  writeValue(valor: string | null): void {
    this.valor.set(valor ?? '');
    this.texto.set(this.etiquetaDe(valor ?? ''));
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
