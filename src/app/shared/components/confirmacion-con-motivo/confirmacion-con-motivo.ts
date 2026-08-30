import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormGroup, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

/**
 * Confirmacion de una accion que exige declarar un motivo.
 *
 * <p><b>No sabe que se esta confirmando.</b> Recibe los textos, valida que el motivo no este
 * vacio y emite el motivo recortado. Que eso termine en una baja de sede, en la suspension
 * de un colaborador o en cualquier otra cosa es asunto de quien la usa: si esta pieza
 * supiera de sedes o de vinculos no podria vivir en `shared/` (AGENT.md 4.1).
 *
 * <p><b>Por que el motivo se valida aca y no solo en el backend.</b> El backend lo exige
 * igual y es la autoridad. Validar antes no es desconfianza: es no gastar un rechazo del
 * servidor para decirle al usuario algo que ya se sabe, y sobre todo poder senalarle el
 * campo exacto en vez de mostrarle un cartel al pie.
 *
 * <p><b>Accesibilidad (WCAG 2.1 AA).</b> El campo tiene `label` real asociado por `for`; el
 * error se anuncia con `aria-describedby` apuntando al parrafo del error -y al texto de
 * ayuda cuando no hay error-; el estado invalido viaja en `aria-invalid`; y el foco entra al
 * campo al abrirse el panel y vuelve a el si el envio se rechaza por motivo vacio. Sin el
 * foco de apertura, quien navega por teclado tiene que recorrer toda la fila de acciones
 * para llegar al formulario que su propio click acaba de abrir.
 *
 * <p>El contenido proyectado va entre el titulo y el campo: es el lugar de las advertencias
 * que dependen de lo que se esta confirmando -"revocar es terminal", "es la sede en la que
 * estas trabajando"-, que son justamente lo que este componente no puede saber.
 */
@Component({
  selector: 'akine-confirmacion-con-motivo, app-confirmacion-con-motivo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  templateUrl: './confirmacion-con-motivo.html',
  styleUrl: './confirmacion-con-motivo.css',
})
export class ConfirmacionConMotivo {
  /**
   * Prefijo de los `id` del campo, su ayuda y su error.
   *
   * <p>Lo elige la pantalla porque puede haber dos confirmaciones distintas en el mismo
   * documento y un `id` fijo las haria colisionar, que es exactamente lo que rompe la
   * asociacion `label`/campo para un lector de pantalla.
   */
  readonly idCampo = input.required<string>();

  /** Encabezado del panel. Ej: "Dar de baja Sede Centro". */
  readonly titulo = input.required<string>();

  readonly etiqueta = input('Motivo');

  /** Texto de ayuda permanente bajo el campo. Vacio = no se renderiza. */
  readonly ayuda = input('');

  readonly textoError = input('El motivo es obligatorio.');

  readonly textoConfirmar = input('Confirmar');

  /** Mientras hay un envio en vuelo el boton de confirmar queda deshabilitado. */
  readonly enviando = input(false);

  /**
   * Si el motivo es obligatorio. Por defecto lo es.
   *
   * <p>No todas las acciones que se confirman con un motivo lo exigen: una baja necesita
   * justificacion escrita, pero activar un perfil de paciente no —RF-M07-008 no la pide, y el
   * contrato declara el campo opcional—. Cuando esto vale `false` el panel <b>envia con el campo
   * vacio</b>; si no fuera configurable, una pantalla que rotule el motivo como opcional se
   * quedaria trabada: el boton no hace nada y la accion es imposible de ejecutar.
   */
  readonly motivoObligatorio = input(true);

  /** Motivo ya recortado. Solo se emite cuando paso la validacion. */
  readonly confirmado = output<string>();

  readonly cancelado = output<void>();

  /**
   * El control va envuelto en un `FormGroup` a proposito.
   *
   * <p>`(ngSubmit)` lo emite la directiva de formulario, no el DOM. Con un `FormControl`
   * suelto y un `[formControl]` en el input, el `<form>` se queda sin `FormGroupDirective` y
   * el binding pasa a escuchar un evento `ngSubmit` que nadie dispara: el boton de confirmar
   * deja de hacer absolutamente nada, sin error en consola ni en compilacion.
   */
  protected readonly formulario = new FormGroup({
    reason: new FormControl('', { nonNullable: true }),
  });

  private get motivo(): FormControl<string> {
    return this.formulario.controls.reason;
  }

  /**
   * Envios rechazados por motivo vacio.
   *
   * <p>El error se muestra si el control fue tocado <b>o</b> si ya hubo un intento: quien
   * manda con Enter sin haber puesto el foco en el campo nunca lo "toca", y sin esto se
   * quedaria mirando un formulario que no hace nada y no dice por que.
   */
  private readonly intentos = signal(0);

  private readonly campo = viewChild<ElementRef<HTMLInputElement>>('campoMotivo');

  constructor() {
    // El validador se aplica aca y no al construir el control: `motivoObligatorio` es un input
    // y su valor no esta disponible todavia en el inicializador del campo.
    effect(() => {
      this.motivo.setValidators(this.motivoObligatorio() ? [Validators.required] : []);
      this.motivo.updateValueAndValidity({ emitEvent: false });
    });

    // El panel se abre por un click en otra parte de la pantalla: el foco tiene que venirse
    // con el, o el usuario de teclado queda parado fuera del formulario que acaba de abrir.
    afterNextRender(() => this.enfocar());
  }

  protected mostrarError(): boolean {
    return this.motivo.invalid && (this.motivo.touched || this.intentos() > 0);
  }

  protected get idError(): string {
    return `${this.idCampo()}-error`;
  }

  protected get idAyuda(): string {
    return `${this.idCampo()}-ayuda`;
  }

  /** `aria-describedby`: el error manda; si no hay error, la ayuda, si existe. */
  protected get descrito(): string | null {
    if (this.mostrarError()) {
      return this.idError;
    }
    return this.ayuda() === '' ? null : this.idAyuda;
  }

  protected confirmar(): void {
    this.intentos.update((valor) => valor + 1);

    if (this.motivo.invalid) {
      this.motivo.markAsTouched();
      this.enfocar();
      return;
    }

    this.confirmado.emit(this.motivo.getRawValue().trim());
  }

  private enfocar(): void {
    this.campo()?.nativeElement.focus();
  }
}
