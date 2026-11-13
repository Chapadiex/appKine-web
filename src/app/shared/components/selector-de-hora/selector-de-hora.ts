import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { HORA_MEDIANOCHE, PATRON_HORA } from '../../utils/horas-de-pared';

/** Valor del desplegable que destapa el campo de hora exacta. Nunca llega al formulario. */
const OTRA_HORA = 'otra';

export type IntervaloDeHora = 15 | 30;

interface OpcionDeHora {
  readonly valor: string;
  readonly rotulo: string;
}

/**
 * Hora de pared en un desplegable (cada 30 o 15 minutos) con salida a una hora exacta.
 *
 * <p>Reemplaza al campo de texto `HH:MM` de los formularios de horarios (rediseño del 05/11/2026):
 * elegir "09:00" de una lista no necesita instrucciones de formato, y la hora que no esta en la
 * grilla —09:10— se escribe eligiendo "Otra hora". El valor sigue siendo el <b>string</b> del
 * contrato: nunca un `Date`, y la medianoche sigue siendo `24:00` (ver `horas-de-pared.ts`), que es
 * justamente lo que un `<input type="time">` no puede expresar.
 *
 * <p>Es un `ControlValueAccessor`: se usa con `formControlName` y los validadores del formulario
 * siguen siendo los de siempre (`validadorDeHora`, el de rango). Lo que escribe el usuario en la
 * hora exacta viaja tal cual al control; validar es del formulario.
 *
 * <p><b>No sabe de dominio.</b> Recibe el `id`, la etiqueta y la grilla; el formulario decide que
 * significa la hora.
 */
@Component({
  selector: 'app-selector-de-hora',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Sin encapsulacion, como el resto de los componentes del sistema de diseno: el formulario que lo
  // usa lo acomoda con las clases globales (`.campo`), y la hoja vive con el componente.
  encapsulation: ViewEncapsulation.None,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectorDeHora), multi: true },
  ],
  styleUrl: './selector-de-hora.css',
  templateUrl: './selector-de-hora.html',
})
export class SelectorDeHora implements ControlValueAccessor {
  /**
   * `id` del desplegable; el campo de hora exacta usa `<id>-exacta`. Unico en la pantalla. No se
   * llama `id` porque un input con ese nombre deja ademas el atributo en el host, y entonces
   * `#alta-bloque-desde` resolvia al componente entero en vez de al control.
   */
  readonly idCampo = input.required<string>();

  readonly etiqueta = input.required<string>();

  /** Cada cuantos minutos hay una opcion. */
  readonly intervalo = input<IntervaloDeHora>(30);

  /** Si la lista llega a la medianoche (`24:00`): la hora de FIN la necesita, la de inicio no. */
  readonly hastaMedianoche = input(false);

  /** Estado invalido que decide el formulario (`aria-invalid`). */
  readonly invalido = input(false);

  /** `id` del mensaje que describe el estado del campo, o `null`. */
  readonly describedBy = input<string | null>(null);

  protected readonly patronHora = PATRON_HORA;
  protected readonly otraHora = OTRA_HORA;

  protected readonly valor = signal('');
  protected readonly deshabilitado = signal(false);

  /** El usuario eligio "Otra hora" y escribe a mano, aunque lo escrito coincida con la grilla. */
  private readonly eligioOtra = signal(false);

  protected readonly opciones = computed<readonly OpcionDeHora[]>(() => {
    const paso = this.intervalo();
    const lista: OpcionDeHora[] = [];
    for (let minutos = 0; minutos < 24 * 60; minutos += paso) {
      const texto = textoDeMinutos(minutos);
      lista.push({ valor: texto, rotulo: texto });
    }
    if (this.hastaMedianoche()) {
      lista.push({ valor: HORA_MEDIANOCHE, rotulo: `${HORA_MEDIANOCHE} (medianoche)` });
    }
    return lista;
  });

  private readonly enLaGrilla = computed(() => {
    const valor = this.valor();
    return valor !== '' && this.opciones().some((opcion) => opcion.valor === valor);
  });

  /** Se muestra el campo de hora exacta: eligio "Otra hora", o el valor cargado no esta en la grilla. */
  protected readonly exacta = computed(() => {
    if (this.eligioOtra()) {
      return true;
    }
    return this.valor() !== '' && !this.enLaGrilla();
  });

  /** Lo que marca el desplegable: la hora si esta en la grilla, "Otra hora" si no, vacio al inicio. */
  protected readonly valorDelDesplegable = computed(() => {
    if (this.exacta()) {
      return OTRA_HORA;
    }
    return this.enLaGrilla() ? this.valor() : '';
  });

  private alCambiar: (valor: string) => void = () => undefined;
  private alTocar: () => void = () => undefined;

  protected elegir(evento: Event): void {
    const elegido = (evento.target as HTMLSelectElement).value;
    if (elegido === OTRA_HORA) {
      this.eligioOtra.set(true);
      // Lo que habia elegido antes sigue siendo valido como punto de partida para escribir.
      return;
    }
    this.eligioOtra.set(false);
    this.valor.set(elegido);
    this.alCambiar(elegido);
  }

  protected escribir(evento: Event): void {
    const escrito = (evento.target as HTMLInputElement).value;
    this.valor.set(escrito);
    this.alCambiar(escrito);
  }

  protected tocar(): void {
    this.alTocar();
  }

  // --- ControlValueAccessor ----------------------------------------------------------------

  writeValue(valor: unknown): void {
    this.valor.set(typeof valor === 'string' ? valor : '');
    // Un valor que llega de afuera (reset, bloque cargado para editar) vuelve a decidir solo si
    // va en la grilla o en la hora exacta.
    this.eligioOtra.set(false);
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

/** `HH:MM` a partir de los minutos desde la medianoche. Inverso de `minutosDeHora`. */
function textoDeMinutos(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return `${String(horas).padStart(2, '0')}:${String(resto).padStart(2, '0')}`;
}
