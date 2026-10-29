import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { PieDeTabla } from '../../../../shared/components/tabla/pie-de-tabla';
import { ValorOrdenable, tablaLocal } from '../../../../shared/components/tabla/tabla-local';
import { celdaEnPalabras, esImporteEnCelda } from '../../models/reportes';

type Fila = readonly string[];

/**
 * Tabla de detalle de una seccion del reporte (UX-14): orden por cualquier columna y el pie
 * estandar con filas por pagina.
 *
 * <p><b>Las columnas las decide el backend</b>: llegan como una lista de titulos y cada fila como
 * una lista de celdas en el mismo orden. Por eso el orden se pide por posicion ("0", "1"…) y no
 * por nombre. Un importe se ordena como numero; lo demas, como texto (el comparador de
 * `tablaLocal` ya ordena "9" antes que "10").
 *
 * <p>Es una lista completa: la seccion llega entera con el reporte, asi que pagina y ordena en la
 * pantalla.
 */
@Component({
  selector: 'app-tabla-de-detalle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ColumnaOrdenable, PieDeTabla],
  template: `
    <div class="tabla-scroll" tabindex="0" role="region" [attr.aria-label]="etiqueta()">
      <table class="tabla">
        <thead>
          <tr>
            @for (columna of columnas(); track $index) {
              <th scope="col" appOrdenable [tabla]="tabla" [columna]="'' + $index">
                {{ columna }}
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (fila of tabla.visibles(); track $index) {
            <tr>
              @for (valorDeCelda of fila; track $index) {
                <td [class.importe]="esImporte(valorDeCelda)">{{ celda(valorDeCelda) }}</td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
    <app-pie-de-tabla [tabla]="tabla" [etiqueta]="'Páginas de ' + etiqueta()" />
  `,
  styles: `
    :host {
      display: block;
    }

    /* Encabezado atenuado, como el canvas. */
    .tabla thead th {
      background: var(--color-superficie-atenuada);
    }

    /* Importes por fila (rentabilidad y caja por servicio, DP-39): alineados para compararlos. */
    .tabla td.importe {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
  `,
})
export class TablaDeDetalle {
  readonly columnas = input.required<readonly string[]>();
  readonly filas = input.required<readonly Fila[]>();
  /** Nombre de la tabla para el lector: "Detalle de Cobros". */
  readonly etiqueta = input.required<string>();

  protected readonly celda = celdaEnPalabras;
  protected readonly esImporte = esImporteEnCelda;

  private readonly filasLeidas = computed(() => this.filas());

  /**
   * Cualquier clave es una posicion de columna: la cantidad de columnas no se sabe al construir la
   * tabla, asi que el lector de cada columna se arma al pedirlo.
   */
  private readonly lectores: Readonly<Record<string, (fila: Fila) => ValorOrdenable>> = new Proxy(
    {},
    {
      get: (_destino, clave) => (fila: Fila) => valorParaOrdenar(fila[Number(String(clave))]),
    },
  );

  protected readonly tabla = tablaLocal(this.filasLeidas, { columnas: this.lectores });
}

function valorParaOrdenar(celda: string | undefined): ValorOrdenable {
  if (celda === undefined) {
    return null;
  }
  return esImporteEnCelda(celda) ? Number(celda) : celda;
}
