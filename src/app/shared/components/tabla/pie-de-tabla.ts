import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { Paginacion } from '../paginacion/paginacion';
import { TablaLocal } from './tabla-local';

/**
 * Pie de una tabla de lista completa (`tablaLocal`): el paginado estandar de AKINE ya cableado.
 *
 * <pre>
 *   <app-pie-de-tabla [tabla]="tabla" etiqueta="Páginas de espacios" />
 * </pre>
 *
 * <p>Para un listado paginado por el servidor se usa `app-paginacion` directo, con `total`,
 * `porPagina` y los dos eventos.
 */
@Component({
  selector: 'app-pie-de-tabla',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Paginacion],
  template: `
    <app-paginacion
      [etiqueta]="etiqueta()"
      [paginaActual]="tabla().pagina()"
      [totalPaginas]="tabla().totalPaginas()"
      [total]="tabla().total()"
      [porPagina]="tabla().porPagina()"
      (cambioDePagina)="tabla().irA($event)"
      (cambioDePorPagina)="tabla().cambiarPorPagina($event)"
    />
  `,
  styles: `
    :host {
      display: contents;
    }
  `,
})
export class PieDeTabla {
  readonly tabla = input.required<TablaLocal<unknown>>();
  readonly etiqueta = input.required<string>();
}
