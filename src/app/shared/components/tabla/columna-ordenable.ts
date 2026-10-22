import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { Icono } from '../icono/icono';
import { TablaLocal } from './tabla-local';

/**
 * Encabezado de una columna ordenable: `<th appOrdenable [tabla]="tabla" columna="nombre">Nombre</th>`.
 *
 * <p>El `th` sigue siendo el `th` (la tabla no pierde su semantica) y adentro lleva un boton: es lo
 * que el teclado alcanza y lo que un lector anuncia como accionable. `aria-sort` va en el `th`, que
 * es donde ARIA lo define, y solo en la columna ordenada: en las demas se omite (no "none").
 *
 * <p>El icono dice el estado sin depender del color: dos flechas sin orden, una flecha para arriba
 * o para abajo con orden. El nombre accesible del boton es el texto de la columna.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'th[appOrdenable]',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly tabla = input.required<TablaLocal<any>>();
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
