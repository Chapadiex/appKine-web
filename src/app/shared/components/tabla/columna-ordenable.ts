import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  ViewEncapsulation,
} from '@angular/core';

import { Icono } from '../icono/icono';
import { Ordenable } from './orden-de-servidor';

/**
 * Encabezado de una columna ordenable: `<th appOrdenable [tabla]="tabla" columna="nombre">Nombre</th>`.
 *
 * <p>El `th` sigue siendo el `th` (la tabla no pierde su semantica) y adentro lleva un boton: es lo
 * que el teclado alcanza y lo que un lector anuncia como accionable. `aria-sort` va en el `th`, que
 * es donde ARIA lo define, y solo en la columna ordenada: en las demas se omite (no "none").
 *
 * <p>El icono dice el estado sin depender del color: dos flechas sin orden, una flecha para arriba
 * o para abajo con orden. El nombre accesible del boton es el texto de la columna.
 *
 * <p>`tabla` es cualquier {@link Ordenable}: una `tablaLocal` (lista completa, ordena en el
 * cliente) o un `ordenDeServidor` (lista paginada, manda `sort` y recarga).
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'th[appOrdenable]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './columna-ordenable.css',
  imports: [Icono],
  host: {
    class: 'tabla__columna-ordenable',
    '[attr.aria-sort]': 'ariaSort()',
  },
  template: `
    <button type="button" class="tabla__orden" (click)="tabla().ordenarPor(columna())">
      <ng-content />
      <app-icono class="tabla__icono-orden" [nombre]="icono()" />
    </button>
  `,
})
export class ColumnaOrdenable {
  readonly tabla = input.required<Ordenable>();
  readonly columna = input.required<string>();

  private readonly direccion = computed(() => {
    const orden = this.tabla().orden();
    return orden?.columna === this.columna() ? orden.direccion : null;
  });

  protected readonly ariaSort = computed(() => {
    const direccion = this.direccion();
    return direccion === null ? null : direccion === 'asc' ? 'ascending' : 'descending';
  });

  protected readonly icono = computed(() => {
    const direccion = this.direccion();
    return direccion === null ? 'orden' : direccion === 'asc' ? 'orden-asc' : 'orden-desc';
  });
}
