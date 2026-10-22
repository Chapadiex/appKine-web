import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/** Un filtro rapido: su valor, su rotulo y cuantas filas lo cumplen. */
export interface FiltroRapido {
  readonly valor: string;

  readonly etiqueta: string;

  readonly cantidad: number;
}

/**
 * Filtros rapidos con conteo ("Todos 12 · Individuales 8 · Grupales 4"), arriba de una tabla.
 *
 * <p>Decidido el 22/10/2026: se usan **solo donde la lista llega entera**, porque el conteo se
 * calcula en pantalla. En una lista paginada por el servidor el numero seria el de la pagina
 * visible y mentiria.
 *
 * <p>Botones con `aria-pressed` dentro de un grupo con nombre: es un conmutador de un valor, no
 * pestanas (no cambia de panel ni de URL). Convive con el buscador y el embudo (`app-filtros`).
 *
 * <p><b>No sabe de dominio.</b> Recibe las opciones ya contadas; el valor elegido es un `model`.
 */
@Component({
  selector: 'app-filtros-rapidos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="filtros-rapidos" role="group" [attr.aria-label]="etiqueta()">
      @for (opcion of opciones(); track opcion.valor) {
        <button
          type="button"
          class="filtros-rapidos__opcion"
          [attr.aria-pressed]="opcion.valor === valor()"
          (click)="valor.set(opcion.valor)"
        >
          {{ opcion.etiqueta }}
          <span class="filtros-rapidos__cantidad">{{ opcion.cantidad }}</span>
        </button>
      }
    </div>
  `,
})
export class FiltrosRapidos {
  readonly opciones = input.required<readonly FiltroRapido[]>();

  /** El valor elegido. La primera opcion suele ser "Todos". */
  readonly valor = model.required<string>();

  /** Nombre del grupo para el lector de pantalla: "Filtrar por modalidad". */
  readonly etiqueta = input.required<string>();
}
