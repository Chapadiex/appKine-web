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

import { OpcionChip } from '../chips/chips';

let siguienteId = 0;

/**
 * Elegir una entre dos a cuatro opciones excluyentes con un toque (modo táctil, 16/11/2026):
 * asistencia, modo de la evaluación, Sí/No.
 *
 * <p>Por dentro son radios nativos en un `fieldset`: Tab entra al grupo y las flechas cambian, como
 * cualquier grupo de radios. Toda la celda es el blanco del toque. Se usa con `[(valor)]` o como
 * `ControlValueAccessor`.
 */
@Component({
  selector: 'app-segmentado',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './segmentado.css',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => Segmentado), multi: true },
  ],
  template: `
    <fieldset class="segmentado-tactil" [disabled]="inactivo()">
      <legend class="visualmente-oculto">{{ etiqueta() }}</legend>
      @for (opcion of opciones(); track opcion.valor) {
        <label class="segmentado-tactil__opcion">
          <input
            type="radio"
            [name]="nombre"
            [value]="opcion.valor"
            [checked]="valor() === opcion.valor"
            (change)="elegir(opcion.valor)"
            (blur)="alTocar()"
          />
          {{ opcion.etiqueta }}
        </label>
      }
    </fieldset>
  `,
})
export class Segmentado implements ControlValueAccessor {
  readonly opciones = input.required<readonly OpcionChip[]>();
  readonly etiqueta = input.required<string>();
  readonly deshabilitado = input(false);
  readonly valor = model<string | null>(null);

  protected readonly nombre = `segmentado-${siguienteId++}`;
  private readonly deshabilitadoPorFormulario = signal(false);
  protected readonly inactivo = computed(
    () => this.deshabilitado() || this.deshabilitadoPorFormulario(),
  );

  private alCambiar: (valor: string | null) => void = () => undefined;
  private alTocarCallback: () => void = () => undefined;

  protected elegir(valor: string): void {
    this.valor.set(valor);
    this.alCambiar(valor);
  }

  protected alTocar(): void {
    this.alTocarCallback();
  }

  writeValue(valor: string | null): void {
    this.valor.set(valor ?? null);
  }

  registerOnChange(fn: (valor: string | null) => void): void {
    this.alCambiar = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.alTocarCallback = fn;
  }

  setDisabledState(deshabilitado: boolean): void {
    this.deshabilitadoPorFormulario.set(deshabilitado);
  }
}
