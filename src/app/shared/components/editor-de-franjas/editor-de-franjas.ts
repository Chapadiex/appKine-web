import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';

import { DIAS_DE_LA_SEMANA } from '../../utils/dias-de-la-semana';
import { PATRON_HORA } from '../../utils/horas-de-pared';
import {
  FranjaForm,
  FranjasForm,
  MAXIMO_FRANJAS,
  crearFranjaForm,
  mensajeDeFranja,
} from '../../utils/franjas-semanales';

/**
 * Editor de una lista de franjas semanales: dia + desde + hasta, con agregar y quitar.
 *
 * <p>Nacio con A-8 para el horario general de la sede, que se carga en el alta
 * (`organization`) y se edita en el calendario (`resource`). Es la misma lista en los dos
 * lugares, asi que vive en `shared/` y <b>no sabe que es una sede</b>: recibe el `FormArray`
 * que el padre arma con `crearFranjasForm()` y lo muta en el lugar. Quien lo usa decide que
 * hacer con las franjas —mandarlas en un alta, reemplazar un horario—.
 *
 * <p><b>Los errores se muestran al lado de la fila que falla</b>, incluidos los que devuelve el
 * backend en un `400` (`erroresDelServidor`, por indice). Un cartel "la franja 3 es invalida"
 * obliga a contar filas; el mensaje junto a la franja no.
 *
 * <p><b>Horas como texto, no `type="time"`:</b> el control nativo vacia `24:00` sin avisar, y
 * `24:00` es la unica forma de decir "hasta la medianoche". Ver `horas-de-pared.ts`.
 */
@Component({
  selector: 'app-editor-de-franjas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  templateUrl: './editor-de-franjas.html',
  styles: `
    .franja {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--esp-4) var(--esp-6);
    }
    .franja .campo {
      flex: 1 1 8rem;
    }
  `,
})
export class EditorDeFranjas {
  /** La lista a editar. El componente la muta: agrega y quita filas en la misma instancia. */
  readonly franjas = input.required<FranjasForm>();

  /** Prefijo de los `id` de los controles: tiene que ser unico en la pantalla. */
  readonly idBase = input.required<string>();

  /** `true` despues de un intento de envio: muestra los errores aunque el campo no se toco. */
  readonly mostrarErrores = input(false);

  /** Errores que devolvio el backend, por indice de fila. */
  readonly erroresDelServidor = input<ReadonlyMap<number, string>>(new Map());

  /**
   * Las filas a pintar, recalculadas con cada evento del `FormArray`.
   *
   * <p>Sin esto el editor no se entera de lo que el padre hace con la lista. Con OnPush y sin
   * zone, el padre que reemplaza las franjas —al cargar el horario guardado, o al borrarlo— muta
   * la MISMA instancia que recibio el input: la referencia no cambia, no hay evento en este
   * componente y la plantilla seguia mostrando las filas viejas.
   */
  private readonly cambios = signal(0);
  protected readonly filas = computed(() => {
    this.cambios();
    return [...this.franjas().controls];
  });

  constructor() {
    effect((alLimpiar) => {
      const suscripcion = this.franjas().events.subscribe(() =>
        this.cambios.update((valor) => valor + 1),
      );
      alLimpiar(() => suscripcion.unsubscribe());
    });
  }

  protected readonly dias = DIAS_DE_LA_SEMANA;
  protected readonly patronHora = PATRON_HORA;
  protected readonly maximo = MAXIMO_FRANJAS;

  protected agregar(): void {
    const lista = this.franjas();
    if (lista.length >= MAXIMO_FRANJAS) {
      return;
    }
    // La franja nueva propone el dia de la ultima: cargar mañana y tarde del mismo dia, o el
    // mismo horario dia por dia, es lo que se hace casi siempre.
    const ultima = lista.at(lista.length - 1) as FranjaForm | undefined;
    lista.push(crearFranjaForm({ diaSemana: ultima?.controls.diaSemana.value ?? 1 }));
  }

  protected quitar(indice: number): void {
    this.franjas().removeAt(indice);
  }

  /** El primer mensaje que corresponde a la fila, o `null`. */
  protected mensajeDeFila(indice: number): string | null {
    return mensajeDeFranja(
      this.franjas(),
      indice,
      this.mostrarErrores(),
      this.erroresDelServidor(),
    );
  }
}
