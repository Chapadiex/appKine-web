import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { Icono, NombreDeIcono } from '../icono/icono';

/** Una alternativa: lo que se guarda, su nombre y una línea que la explica. */
export interface OpcionEnTarjeta {
  readonly valor: string;
  readonly etiqueta: string;
  readonly descripcion: string;
  readonly icono?: NombreDeIcono;
}

let siguienteId = 0;

/**
 * Elección única entre pocas alternativas que hay que poder comparar sin abrir un menú (10/11/2026):
 * cada una es una tarjeta con su nombre y su explicación a la vista.
 *
 * <p>Por dentro son radios nativos en un `fieldset`: el teclado (Tab entra al grupo, flechas
 * cambian), el lector de pantalla y el foco vienen del navegador. Toda la tarjeta es el `label`.
 * La elegida se marca con borde, fondo y tilde, no sólo con color.
 *
 * <p>Es un `ControlValueAccessor`: se usa con `formControlName`. La leyenda y su "?" se proyectan
 * con `[leyenda]`; el error va por el input `error` y queda asociado al grupo.
 */
@Component({
  selector: 'app-opciones-en-tarjetas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [Icono],
  styleUrl: './opciones-en-tarjetas.css',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => OpcionesEnTarjetas), multi: true },
  ],
  template: `
    <fieldset
      class="opciones-en-tarjetas"
      [class.opciones-en-tarjetas--dos]="columnas() === 2"
      [attr.aria-invalid]="error() ? 'true' : null"
      [attr.aria-describedby]="error() ? idError : null"
    >
      <legend class="opciones-en-tarjetas__leyenda"><ng-content select="[leyenda]" /></legend>
      <div class="opciones-en-tarjetas__grilla">
        @for (opcion of opciones(); track opcion.valor; let i = $index) {
          <label
            class="opcion-en-tarjeta"
            [class.opcion-en-tarjeta--elegida]="valor() === opcion.valor"
          >
            <!-- El nombre es la etiqueta; la explicación se lee aparte, como descripción. -->
            <input
              type="radio"
              class="visualmente-oculto"
              [name]="nombre"
              [value]="opcion.valor"
              [attr.aria-labelledby]="nombre + '-' + i"
              [attr.aria-describedby]="nombre + '-' + i + '-detalle'"
              [checked]="valor() === opcion.valor"
              [disabled]="deshabilitado()"
              (change)="elegir(opcion.valor)"
              (blur)="alTocar()"
            />
            @if (opcion.icono; as icono) {
              <app-icono class="opcion-en-tarjeta__icono" [nombre]="icono" />
            }
            <span class="opcion-en-tarjeta__textos">
              <span class="opcion-en-tarjeta__etiqueta" [id]="nombre + '-' + i">{{
                opcion.etiqueta
              }}</span>
              <span class="opcion-en-tarjeta__descripcion" [id]="nombre + '-' + i + '-detalle'">{{
                opcion.descripcion
              }}</span>
            </span>
            <span class="opcion-en-tarjeta__marca" aria-hidden="true">
              @if (valor() === opcion.valor) {
                <app-icono nombre="tilde" />
              }
            </span>
          </label>
        }
      </div>
      @if (error(); as mensaje) {
        <p class="campo__error" [id]="idError" role="alert">{{ mensaje }}</p>
      }
      <ng-content />
    </fieldset>
  `,
})
export class OpcionesEnTarjetas implements ControlValueAccessor {
  readonly opciones = input.required<readonly OpcionEnTarjeta[]>();
  /** 1 = una tarjeta por fila; 2 = dos por fila mientras entren (en un teléfono, una). */
  readonly columnas = input<1 | 2>(2);
  /** Mensaje de error del grupo; `null` sin error. */
  readonly error = input<string | null>(null);

  protected readonly nombre = `opciones-en-tarjetas-${siguienteId++}`;
  protected readonly idError = `${this.nombre}-error`;
  protected readonly valor = signal<string>('');
  protected readonly deshabilitado = signal(false);

  private alCambiar: (valor: string) => void = () => undefined;
  private alTocarCallback: () => void = () => undefined;

  protected elegir(valor: string): void {
    this.valor.set(valor);
    this.alCambiar(valor);
  }

  protected alTocar(): void {
    this.alTocarCallback();
  }

  writeValue(valor: string | null): void {
    this.valor.set(valor ?? '');
  }

  registerOnChange(fn: (valor: string) => void): void {
    this.alCambiar = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.alTocarCallback = fn;
  }

  setDisabledState(deshabilitado: boolean): void {
    this.deshabilitado.set(deshabilitado);
  }
}
