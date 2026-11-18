import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { Dictado } from '../../dictado/dictado.directive';

/**
 * Texto libre que nunca es obligatorio (modo táctil, 16/11/2026): en la tablet escribir cuesta, así
 * que el rótulo dice "(opcional)" y, sólo en modo táctil, una pista recuerda el micrófono del
 * teclado. Nunca lleva `required`. `confirmado` sale al dejar el campo.
 */
@Component({
  selector: 'app-texto-opcional',
  imports: [Dictado],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './texto-opcional.css',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => TextoOpcional), multi: true },
  ],
  template: `
    <label class="texto-opcional__etiqueta" [for]="idCampo()">
      {{ etiqueta() }} <span class="campo__opcional">(opcional)</span>
    </label>
    @if (multilinea()) {
      <textarea
        appDictado
        class="texto-opcional__campo"
        autocapitalize="sentences"
        enterkeyhint="done"
        [id]="idCampo()"
        [rows]="filas()"
        [attr.maxlength]="maxlength()"
        [attr.placeholder]="placeholder() || null"
        [attr.aria-describedby]="describedby()"
        [disabled]="inactivo()"
        [value]="valor()"
        (input)="escribir($any($event.target).value)"
        (blur)="alSalir()"
      ></textarea>
    } @else {
      <input
        appDictado
        type="text"
        class="texto-opcional__campo"
        autocapitalize="sentences"
        enterkeyhint="done"
        [id]="idCampo()"
        [attr.maxlength]="maxlength()"
        [attr.placeholder]="placeholder() || null"
        [attr.aria-describedby]="describedby()"
        [disabled]="inactivo()"
        [value]="valor()"
        (input)="escribir($any($event.target).value)"
        (blur)="alSalir()"
      />
    }
    @if (descripcion()) {
      <p class="ayuda texto-opcional__descripcion" [id]="idCampo() + '-descripcion'">
        {{ descripcion() }}
      </p>
    }
    <p class="texto-opcional__pista" [id]="idCampo() + '-pista'">
      Podés dictar con el micrófono del teclado.
    </p>
  `,
})
export class TextoOpcional implements ControlValueAccessor {
  readonly idCampo = input.required<string>();
  readonly etiqueta = input.required<string>();
  readonly multilinea = input(false);
  readonly filas = input(3);
  readonly maxlength = input(500);
  readonly placeholder = input('');
  readonly deshabilitado = input(false);
  /** Explicación corta debajo del campo, leída como descripción. */
  readonly descripcion = input('');
  readonly valor = model('');
  readonly confirmado = output<string>();

  private readonly deshabilitadoPorFormulario = signal(false);
  protected readonly inactivo = computed(
    () => this.deshabilitado() || this.deshabilitadoPorFormulario(),
  );

  protected readonly describedby = computed(() =>
    this.descripcion()
      ? `${this.idCampo()}-descripcion ${this.idCampo()}-pista`
      : `${this.idCampo()}-pista`,
  );

  private alCambiar: (valor: string) => void = () => undefined;
  private alTocarCallback: () => void = () => undefined;

  protected escribir(texto: string): void {
    this.valor.set(texto);
    this.alCambiar(texto);
  }

  protected alSalir(): void {
    this.alTocarCallback();
    this.confirmado.emit(this.valor());
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
    this.deshabilitadoPorFormulario.set(deshabilitado);
  }
}
