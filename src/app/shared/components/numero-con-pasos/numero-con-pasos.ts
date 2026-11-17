import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/** Espera después del último toque de −/+ antes de confirmar: una ráfaga es un solo guardado. */
export const ESPERA_DE_CONFIRMACION_MS = 700;
const PRIMERA_REPETICION_MS = 450;
const RITMO_DE_REPETICION_MS = 120;

/**
 * Número que se carga con el dedo (modo táctil, 16/11/2026): botones − y + a los costados y el
 * campo en el medio para escribirlo si hace falta. Acepta coma o punto y muestra con coma.
 *
 * <p>Texto que no es número, con más decimales de los que admite o fuera de `[min, max]` no cambia
 * el valor: marca el campo inválido y avisa por `invalido`. Vacío es `null`. −/+ arrancan en
 * `desdeVacio` (o en el mínimo) si no hay valor, no salen de `[min, max]` y se apagan en el borde.
 *
 * <p>El paso se da en el `click`, no al apoyar el dedo: un dedo que empieza a scrollear sobre el
 * botón no cambia un dato clínico. Mantener apretado repite.
 *
 * <p>`confirmado` sale al dejar el campo y 700 ms después del último toque de −/+: quien guarda
 * campo a campo guarda una vez por ráfaga, no una por toque.
 */
@Component({
  selector: 'app-numero-con-pasos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './numero-con-pasos.css',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => NumeroConPasos), multi: true },
  ],
  template: `
    <button
      type="button"
      class="numero-con-pasos__paso"
      [attr.aria-label]="'Restar ' + pasoVisible() + ' a ' + etiqueta()"
      [disabled]="inactivo() || enMinimo()"
      (pointerdown)="apoyar(-1, $event)"
      (pointerup)="soltar()"
      (pointerleave)="cancelar()"
      (pointercancel)="cancelar()"
      (click)="tocar(-1)"
    >
      −
    </button>
    <input
      type="text"
      #campo
      class="numero-con-pasos__campo"
      autocomplete="off"
      enterkeyhint="done"
      [id]="idCampo()"
      [attr.aria-label]="rotuloDelCampo()"
      [attr.inputmode]="decimales() > 0 ? 'decimal' : 'numeric'"
      [attr.aria-invalid]="textoInvalido() ? 'true' : null"
      [disabled]="inactivo()"
      (input)="escribir($any($event.target).value)"
      (blur)="alSalir()"
    />
    <button
      type="button"
      class="numero-con-pasos__paso"
      [attr.aria-label]="'Sumar ' + pasoVisible() + ' a ' + etiqueta()"
      [disabled]="inactivo() || enMaximo()"
      (pointerdown)="apoyar(1, $event)"
      (pointerup)="soltar()"
      (pointerleave)="cancelar()"
      (pointercancel)="cancelar()"
      (click)="tocar(1)"
    >
      +
    </button>
  `,
})
export class NumeroConPasos implements ControlValueAccessor {
  readonly idCampo = input.required<string>();
  /** Nombre del dato, para los rótulos de −/+ ("Sumar 0,5 a Peso"). */
  readonly etiqueta = input.required<string>();
  /** Rótulo del campo cuando no hay un `label for` afuera (una fila de una tabla). */
  readonly rotuloDelCampo = input<string | null>(null);
  readonly paso = input(1);
  readonly min = input<number | null>(null);
  readonly max = input<number | null>(null);
  readonly decimales = input(0);
  /** Dónde arranca el primer −/+ sin valor (el año actual para un año); si no, el mínimo. */
  readonly desdeVacio = input<number | null>(null);
  readonly deshabilitado = input(false);
  readonly valor = model<number | null>(null);
  readonly confirmado = output<number | null>();
  readonly invalido = output<boolean>();

  private readonly deshabilitadoPorFormulario = signal(false);
  protected readonly inactivo = computed(
    () => this.deshabilitado() || this.deshabilitadoPorFormulario(),
  );
  /**
   * Lo escrito tal cual, mientras se escribe. Si el valor cambia desde afuera (el padre lo limpia
   * después de registrar, o precarga otro) y ya no es lo escrito, el campo vuelve a mostrar el valor.
   */
  private readonly escrito = linkedSignal<number | null, string | null>({
    source: this.valor,
    computation: (valor, anterior) => {
      const texto = anterior?.value ?? null;
      if (texto === null) {
        return null;
      }
      const leido = leer(texto);
      return leido === valor || (leido === undefined && untracked(this.textoInvalido))
        ? texto
        : null;
    },
  });
  protected readonly textoInvalido = signal(false);
  protected readonly texto = computed(() => this.escrito() ?? this.formatear(this.valor()));
  protected readonly pasoVisible = computed(() => String(this.paso()).replace('.', ','));
  protected readonly enMinimo = computed(() => {
    const min = this.min();
    const valor = this.valor();
    return min !== null && valor !== null && valor <= min;
  });
  protected readonly enMaximo = computed(() => {
    const max = this.max();
    const valor = this.valor();
    return max !== null && valor !== null && valor >= max;
  });

  private esperaDeConfirmacion: ReturnType<typeof setTimeout> | null = null;
  private repeticion: ReturnType<typeof setTimeout> | null = null;
  /** Mantener apretado ya dio pasos: el `click` que llega al soltar no suma otro. */
  private repitio = false;

  private alCambiar: (valor: number | null) => void = () => undefined;
  private alTocarCallback: () => void = () => undefined;

  private readonly campo = viewChild.required<ElementRef<HTMLInputElement>>('campo');

  constructor() {
    // El campo se escribe a mano: un [value] no se reescribe si el texto vuelve a lo que tenía en el
    // último render (escribir 45 y que el padre lo limpie deja "45" en pantalla).
    effect(() => {
      const texto = this.texto();
      const campo = this.campo().nativeElement;
      if (campo.value !== texto) {
        campo.value = texto;
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.cancelarEspera();
      this.cancelar();
    });
  }

  protected escribir(texto: string): void {
    const leido = leer(texto);
    this.escrito.set(texto);
    if (leido === null) {
      this.marcarInvalido(false);
      this.cambiar(null);
      return;
    }
    const max = this.max();
    const fueraDeForma =
      leido === undefined || decimalesDe(texto) > this.decimales() || (max !== null && leido > max);
    if (fueraDeForma) {
      this.marcarInvalido(true);
      return;
    }
    const min = this.min();
    if (min !== null && leido < min) {
      // Puede ser un número a medio escribir ("17" camino a "175"): no se emite, y al salir del
      // campo se marca si quedó así.
      this.marcarInvalido(false);
      return;
    }
    this.marcarInvalido(false);
    this.cambiar(leido);
  }

  protected alSalir(): void {
    const texto = this.escrito();
    const min = this.min();
    if (texto !== null && !this.textoInvalido()) {
      const leido = leer(texto);
      if (typeof leido === 'number' && min !== null && leido < min) {
        this.marcarInvalido(true);
      }
    }
    // Al salir el campo muestra el valor con su formato, salvo que siga inválido.
    if (!this.textoInvalido()) {
      this.escrito.set(null);
    }
    this.cancelarEspera();
    this.alTocarCallback();
    this.confirmado.emit(this.valor());
  }

  /** Apoyar el dedo no cambia nada: sólo arma la repetición por si se mantiene apretado. */
  protected apoyar(direccion: 1 | -1, evento: PointerEvent): void {
    if (evento.button !== 0) {
      return;
    }
    this.cancelar();
    const repetir = (demora: number): void => {
      this.repeticion = setTimeout(() => {
        if (!this.pasar(direccion)) {
          return;
        }
        this.repitio = true;
        repetir(RITMO_DE_REPETICION_MS);
      }, demora);
    };
    repetir(PRIMERA_REPETICION_MS);
  }

  /** Se levantó el dedo sobre el botón: el `click` que sigue decide si suma. */
  protected soltar(): void {
    this.cortarRepeticion();
  }

  /** El dedo se fue o el navegador lo tomó para scrollear: no llega `click`, nada queda armado. */
  protected cancelar(): void {
    this.cortarRepeticion();
    this.repitio = false;
  }

  /** Un toque, Enter o Espacio: un paso, salvo que mantener apretado ya los haya dado. */
  protected tocar(direccion: 1 | -1): void {
    if (this.repitio) {
      this.repitio = false;
      return;
    }
    this.pasar(direccion);
  }

  private cortarRepeticion(): void {
    if (this.repeticion !== null) {
      clearTimeout(this.repeticion);
      this.repeticion = null;
    }
  }

  /** Mueve un paso; devuelve `false` si ya estaba en el borde. */
  private pasar(direccion: 1 | -1): boolean {
    const min = this.min();
    const max = this.max();
    const actual = this.valor();
    // Desde vacío arranca donde se pidió; si no, en el mínimo, o en el paso cuando es mayor a 1
    // (minutos de a 5) para que los toques siguientes caigan en múltiplos redondos.
    const desde =
      this.desdeVacio() ?? Math.max(min ?? 0, this.paso() > 1 ? this.paso() : (min ?? 0));
    let nuevo = actual === null ? desde : actual + direccion * this.paso();
    nuevo = Number(nuevo.toFixed(this.decimales()));
    if (min !== null) {
      nuevo = Math.max(min, nuevo);
    }
    if (max !== null) {
      nuevo = Math.min(max, nuevo);
    }
    if (nuevo === actual) {
      return false;
    }
    this.marcarInvalido(false);
    this.escrito.set(null);
    this.cambiar(nuevo);
    this.programarConfirmacion();
    return true;
  }

  private programarConfirmacion(): void {
    this.cancelarEspera();
    this.esperaDeConfirmacion = setTimeout(() => {
      this.esperaDeConfirmacion = null;
      this.confirmado.emit(this.valor());
    }, ESPERA_DE_CONFIRMACION_MS);
  }

  private cancelarEspera(): void {
    if (this.esperaDeConfirmacion !== null) {
      clearTimeout(this.esperaDeConfirmacion);
      this.esperaDeConfirmacion = null;
    }
  }

  private cambiar(valor: number | null): void {
    this.valor.set(valor);
    this.alCambiar(valor);
  }

  private marcarInvalido(invalido: boolean): void {
    if (this.textoInvalido() !== invalido) {
      this.textoInvalido.set(invalido);
      this.invalido.emit(invalido);
    }
  }

  private formatear(valor: number | null): string {
    if (valor === null) {
      return '';
    }
    const decimales = this.decimales();
    const texto =
      decimales > 0 ? String(Number(valor.toFixed(decimales))) : String(Math.round(valor));
    return texto.replace('.', ',');
  }

  writeValue(valor: number | null): void {
    this.escrito.set(null);
    this.marcarInvalido(false);
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

/** `null` si está vacío, `undefined` si no es un número; acepta coma o punto. */
function leer(texto: string): number | null | undefined {
  const limpio = texto.trim();
  if (limpio === '') {
    return null;
  }
  return /^-?\d+([.,]\d+)?$/.test(limpio) ? Number(limpio.replace(',', '.')) : undefined;
}

function decimalesDe(texto: string): number {
  const parte = texto.trim().split(/[.,]/)[1];
  return parte === undefined ? 0 : parte.length;
}
