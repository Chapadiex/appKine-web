import { ChangeDetectionStrategy, Component, input, ViewEncapsulation } from '@angular/core';

/**
 * Estado vacio de un listado (UX-14): en lugar de una tabla vacia, que dice que paso y que hacer.
 *
 * <pre>
 *   <app-estado-vacio titulo="No hay sedes todavía" texto="Abrí la primera para empezar.">
 *     <a class="boton" routerLink="/organizacion/sedes/nueva">Abrir una sede</a>
 *   </app-estado-vacio>
 *
 *   <app-estado-vacio filtrado titulo="No encontramos sedes" texto="Probá con otra búsqueda o filtros.">
 *     <button class="boton boton--secundario" (click)="limpiar()">Limpiar filtros</button>
 *   </app-estado-vacio>
 * </pre>
 *
 * <p><b>Dos casos distintos.</b> "Todavia no hay" invita a crear; "no hay con esta busqueda"
 * invita a limpiar. Mezclarlos hace creer que se perdieron datos.
 *
 * <p>Es `role="status"`: aparece cuando cambia la busqueda y el lector lo anuncia.
 */
@Component({
  selector: 'app-estado-vacio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './estado-vacio.css',
  template: `
    <p class="estado-vacio__titulo">{{ titulo() }}</p>
    @if (texto()) {
      <p class="estado-vacio__texto">{{ texto() }}</p>
    }
    <div class="estado-vacio__acciones"><ng-content /></div>
  `,
  host: { class: 'estado-vacio', role: 'status' },
})
export class EstadoVacio {
  readonly titulo = input.required<string>();
  readonly texto = input<string | null>(null);
}
