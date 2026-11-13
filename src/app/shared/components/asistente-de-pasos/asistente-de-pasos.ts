import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  output,
} from '@angular/core';

/** Un paso del asistente: su numero (desde 1), el titulo y una linea de detalle. */
export interface PasoDeAsistente {
  readonly numero: number;
  readonly titulo: string;
  readonly sub: string;
}

/**
 * Indicador de progreso de un asistente por pasos (06/11/2026): el unico stepper de la aplicacion.
 *
 * <p><b>Por que existe.</b> El alta de sede y la importacion de aranceles dibujaban la misma franja
 * de pasos con dos copias de CSS casi identicas (`.asistente__paso` en `organization.css`, `.paso` en
 * `contracting.css`) que ya habian empezado a divergir en el espaciado y en el corte del telefono.
 *
 * <p><b>Patron.</b> Una tarjeta `.tarjeta.asistente` con este indicador arriba, a todo el ancho, y
 * debajo `.asistente__contenido`: el `h2.asistente__encabezado` (con `.asistente__numero`, "Paso 2 de
 * 3"), el contenido del paso y `.acciones.asistente__acciones` al pie, con la accion principal en el
 * borde derecho. Los estilos de esas clases viajan con este componente (sin encapsulacion): solo se
 * cargan en las pantallas que tienen un asistente.
 *
 * <p>Un paso ya hecho es un boton que vuelve a el; el actual lleva `aria-current="step"`; los que
 * faltan son rotulos. Con `completo` todos se marcan hechos y ninguno vuelve (el alta ya ocurrio).
 *
 * <p><b>No sabe de dominio.</b> Recibe los pasos y cual es el actual; quien lo usa decide si se
 * puede volver.
 */
@Component({
  selector: 'app-asistente-de-pasos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './asistente-de-pasos.css',
  template: `
    <ol class="indicador-pasos" [attr.aria-label]="etiqueta()">
      @for (item of pasos(); track item.numero) {
        <li
          class="indicador-pasos__item"
          [class.indicador-pasos__item--actual]="item.numero === actual() && !completo()"
          [class.indicador-pasos__item--hecho]="item.numero < actual() || completo()"
          [attr.aria-current]="item.numero === actual() && !completo() ? 'step' : null"
        >
          @if (item.numero < actual() && !completo()) {
            <button
              type="button"
              class="indicador-pasos__volver"
              (click)="volver.emit(item.numero)"
            >
              <span class="indicador-pasos__numero" aria-hidden="true">✓</span>
              <span class="indicador-pasos__textos">
                <span class="indicador-pasos__titulo">{{ item.titulo }}</span>
                <span class="indicador-pasos__sub">{{ item.sub }}</span>
              </span>
              <span class="visualmente-oculto">(completado, volver a este paso)</span>
            </button>
          } @else {
            <span class="indicador-pasos__numero" aria-hidden="true">{{
              item.numero < actual() || completo() ? '✓' : item.numero
            }}</span>
            <span class="indicador-pasos__textos">
              <span class="indicador-pasos__titulo">{{ item.titulo }}</span>
              <span class="indicador-pasos__sub">{{ item.sub }}</span>
            </span>
          }
        </li>
      }
    </ol>
  `,
})
export class AsistenteDePasos {
  readonly pasos = input.required<readonly PasoDeAsistente[]>();
  /** Numero del paso en curso. */
  readonly actual = input.required<number>();
  /** Nombre de la lista para un lector de pantalla: "Pasos para abrir la sede". */
  readonly etiqueta = input.required<string>();
  /** El asistente termino: todos hechos, ninguno vuelve. */
  readonly completo = input(false);
  /** Pidieron volver a un paso ya hecho. */
  readonly volver = output<number>();
}
