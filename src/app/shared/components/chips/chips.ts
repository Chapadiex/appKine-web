import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  forwardRef,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/** Una opción que se elige con un toque. `tono` pinta la evolución (mejor, igual, peor). */
export interface OpcionChip {
  readonly valor: string;
  readonly etiqueta: string;
  readonly tono?: 'mejor' | 'igual' | 'peor' | 'neutro';
}

type ValorDeChips = string | readonly string[] | null;

/**
 * Elegir con un toque en vez de escribir o abrir un menú (modo táctil, 16/11/2026). Para hasta
 * siete opciones fijas; con más, o con un catálogo que crece, va un buscador o un select.
 *
 * <p>Cada opción es un botón con `aria-pressed`: el estado que anuncia el lector es el mismo que
 * pinta el estilo. El elegido se marca con relleno y tilde, no sólo con color. Las flechas mueven
 * el foco dentro del grupo y Tab sale de él (un solo blanco de tabulación).
 *
 * <p>`multiple` acumula una lista; si no, el valor es un texto o `null`. "Otra…" es un campo corto
 * al final para lo que no está en la lista. Se usa con `[(valor)]` o como `ControlValueAccessor`.
 */
@Component({
  selector: 'app-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './chips.css',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => Chips), multi: true }],
  host: { role: 'group', '[attr.aria-label]': 'etiqueta()', class: 'chips-tactiles' },
  template: `
    @for (opcion of opciones(); track opcion.valor; let i = $index) {
      <button
        type="button"
        class="chip-tactil"
        [class.chip-tactil--mejor]="opcion.tono === 'mejor'"
        [class.chip-tactil--igual]="opcion.tono === 'igual'"
        [class.chip-tactil--peor]="opcion.tono === 'peor'"
        [class.chip-tactil--neutro]="opcion.tono === 'neutro'"
        [attr.aria-pressed]="estaElegida(opcion.valor)"
        [attr.tabindex]="i === indiceEnfocable() ? 0 : -1"
        [disabled]="inactivo()"
        (click)="tocar(opcion.valor)"
        (keydown)="alTeclear($event, i)"
        (blur)="alTocar()"
      >
        {{ opcion.etiqueta }}
      </button>
    }
    @if (permitirOtra()) {
      <input
        type="text"
        class="chip-tactil-otra"
        [id]="idOtra()"
        maxlength="80"
        placeholder="Otra…"
        [attr.aria-label]="'Otra opción de ' + etiqueta()"
        [disabled]="inactivo()"
        [value]="textoOtra()"
        (change)="textoOtra.set($any($event.target).value)"
      />
    }
  `,
})
export class Chips implements ControlValueAccessor {
  readonly opciones = input.required<readonly OpcionChip[]>();
  /** Nombre del grupo para el lector de pantalla. */
  readonly etiqueta = input.required<string>();
  readonly multiple = input(false);
  /** En elección única, tocar el elegido lo deja sin elegir. */
  readonly deseleccionable = input(true);
  readonly deshabilitado = input(false);
  readonly permitirOtra = input(false);
  /** Id del campo "Otra…", para un `label` o un test. */
  readonly idOtra = input<string | null>(null);
  readonly textoOtra = model('');
  readonly valor = model<ValorDeChips>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly deshabilitadoPorFormulario = signal(false);
  protected readonly inactivo = computed(
    () => this.deshabilitado() || this.deshabilitadoPorFormulario(),
  );
  /** Roving tabindex: el elegido (o el primero) es el único blanco de Tab. */
  private readonly foco = signal<number | null>(null);
  protected readonly indiceEnfocable = computed(() => {
    const enfocado = this.foco();
    if (enfocado !== null) {
      return enfocado;
    }
    const indice = this.opciones().findIndex((o) => this.estaElegida(o.valor));
    return indice < 0 ? 0 : indice;
  });

  private alCambiar: (valor: ValorDeChips) => void = () => undefined;
  private alTocarCallback: () => void = () => undefined;

  protected estaElegida(valor: string): boolean {
    const actual = this.valor();
    return Array.isArray(actual) ? actual.includes(valor) : actual === valor;
  }

  protected tocar(valor: string): void {
    let nuevo: ValorDeChips;
    if (this.multiple()) {
      const actual = Array.isArray(this.valor()) ? (this.valor() as readonly string[]) : [];
      nuevo = actual.includes(valor) ? actual.filter((v) => v !== valor) : [...actual, valor];
    } else if (this.valor() === valor) {
      if (!this.deseleccionable()) {
        return;
      }
      nuevo = null;
    } else {
      nuevo = valor;
    }
    this.valor.set(nuevo);
    this.alCambiar(nuevo);
  }

  protected alTeclear(evento: KeyboardEvent, indice: number): void {
    const total = this.opciones().length;
    const destinos: Record<string, number> = {
      ArrowRight: (indice + 1) % total,
      ArrowDown: (indice + 1) % total,
      ArrowLeft: (indice - 1 + total) % total,
      ArrowUp: (indice - 1 + total) % total,
      Home: 0,
      End: total - 1,
    };
    const destino = destinos[evento.key];
    if (destino === undefined) {
      return;
    }
    evento.preventDefault();
    this.foco.set(destino);
    this.host.nativeElement.querySelectorAll<HTMLButtonElement>('.chip-tactil')[destino]?.focus();
  }

  protected alTocar(): void {
    this.alTocarCallback();
  }

  writeValue(valor: ValorDeChips): void {
    this.valor.set(valor ?? (this.multiple() ? [] : null));
  }

  registerOnChange(fn: (valor: ValorDeChips) => void): void {
    this.alCambiar = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.alTocarCallback = fn;
  }

  setDisabledState(deshabilitado: boolean): void {
    this.deshabilitadoPorFormulario.set(deshabilitado);
  }
}
