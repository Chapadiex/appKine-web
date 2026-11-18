import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  model,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Escala numérica de toque (dolor 0–10, modo táctil 16/11/2026). Un botón por valor con
 * `aria-pressed`; tocar el elegido lo borra. Tonos: bajo (≤3) verde, medio (4–6) amarillo y alto
 * (≥7) rojo, con el número siempre escrito.
 */
@Component({
  selector: 'app-escala',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './escala.css',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => Escala), multi: true }],
  host: { role: 'group', '[attr.aria-label]': 'etiqueta()', class: 'escala-tactil' },
  template: `
    @for (n of pasos(); track n) {
      <button
        type="button"
        class="escala-tactil__paso"
        [class.escala-tactil__paso--bajo]="n <= 3"
        [class.escala-tactil__paso--medio]="n >= 4 && n <= 6"
        [class.escala-tactil__paso--alto]="n >= 7"
        [attr.aria-pressed]="valor() === n"
        [attr.aria-label]="n + ' de ' + hasta()"
        [disabled]="inactivo()"
        (click)="tocar(n)"
        (blur)="alTocar()"
      >
        {{ n }}
      </button>
    }
  `,
})
export class Escala implements ControlValueAccessor {
  readonly desde = input(0);
  readonly hasta = input(10);
  readonly etiqueta = input.required<string>();
  readonly deshabilitado = input(false);
  readonly valor = model<number | null>(null);

  protected readonly pasos = computed(() =>
    Array.from({ length: this.hasta() - this.desde() + 1 }, (_, i) => this.desde() + i),
  );
  private readonly deshabilitadoPorFormulario = signal(false);
  protected readonly inactivo = computed(
    () => this.deshabilitado() || this.deshabilitadoPorFormulario(),
  );

  private alCambiar: (valor: number | null) => void = () => undefined;
  private alTocarCallback: () => void = () => undefined;

  protected tocar(n: number): void {
    const nuevo = this.valor() === n ? null : n;
    this.valor.set(nuevo);
    this.alCambiar(nuevo);
  }

  protected alTocar(): void {
    this.alTocarCallback();
  }

  writeValue(valor: number | null): void {
    this.valor.set(valor ?? null);
  }

  registerOnChange(fn: (valor: number | null) => void): void {
    this.alCambiar = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.alTocarCallback = fn;
  }

  setDisabledState(deshabilitado: boolean): void {
    this.deshabilitadoPorFormulario.set(deshabilitado);
  }
}
