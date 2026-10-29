import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { PlanCatalogoResponse } from '../../../../api/generated/model/plan-catalogo-response';
import { AccionesDeFila } from '../../../../shared/components/acciones-de-fila/acciones-de-fila';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { PieDeTabla } from '../../../../shared/components/tabla/pie-de-tabla';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';

/**
 * Planes de una entrada del catalogo global de financiadores (UX-14): una tabla interna chica con
 * orden, pie y vacio, como toda tabla de AKINE.
 *
 * <p>Es un componente aparte porque cada entrada del catalogo tiene su propia lista de planes, y
 * el orden y la pagina son de cada tabla: un `tablaLocal` por entrada no se puede declarar dentro
 * del `@for` de la pantalla.
 *
 * <p>No decide nada: las acciones salen como eventos y la pantalla abre su panel lateral.
 */
@Component({
  selector: 'app-planes-del-catalogo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AccionesDeFila, ColumnaOrdenable, EstadoVacio, PieDeTabla],
  template: `
    @if (tabla.total() === 0) {
      <app-estado-vacio
        titulo="Sin planes cargados."
        texto="Agregá el primero desde la acción de la entrada."
      />
    } @else {
      <div
        class="tabla-scroll"
        tabindex="0"
        role="region"
        [attr.aria-label]="'Planes de ' + financiador()"
      >
        <table class="tabla">
          <thead>
            <tr>
              <th scope="col" appOrdenable [tabla]="tabla" columna="plan">Plan</th>
              <th scope="col" appOrdenable [tabla]="tabla" columna="vigencia">Vigencia</th>
              <th scope="col" appOrdenable [tabla]="tabla" columna="estado">Estado</th>
              <th scope="col"><span class="visualmente-oculto">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            @for (plan of tabla.visibles(); track plan.id) {
              <tr
                [class.fila--revocada]="plan.estado === 'INACTIVO'"
                [class.fila--seleccionada]="seleccionado() === plan.id"
              >
                <th scope="row">
                  {{ plan.nombre }}
                  <p class="ayuda ayuda--fija">Código {{ plan.codigo }}</p>
                </th>
                <td>{{ plan.vigenciaDesde }} a {{ plan.vigenciaHasta || 'sin fin' }}</td>
                <td>
                  <span
                    class="marca-estado"
                    [class.marca-estado--activa]="plan.estado !== 'INACTIVO'"
                    [class.marca-estado--revocada]="plan.estado === 'INACTIVO'"
                    >{{ plan.estado === 'INACTIVO' ? 'Dado de baja' : 'Activo' }}</span
                  >
                </td>
                <td class="tabla__acciones">
                  @if (plan.estado !== 'INACTIVO' && editable()) {
                    <app-acciones-de-fila [de]="'el plan ' + (plan.nombre ?? '')">
                      <button
                        principal
                        type="button"
                        class="boton boton--secundario boton--chico"
                        (click)="editar.emit(plan)"
                      >
                        Editar <span class="visualmente-oculto">el plan {{ plan.nombre }}</span>
                      </button>
                      <button type="button" class="accion--peligro" (click)="baja.emit(plan)">
                        Dar de baja
                        <span class="visualmente-oculto">el plan {{ plan.nombre }}</span>
                      </button>
                    </app-acciones-de-fila>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <app-pie-de-tabla [tabla]="tabla" [etiqueta]="'Páginas de planes de ' + financiador()" />
    }
  `,
})
export class PlanesDelCatalogo {
  readonly planes = input.required<readonly PlanCatalogoResponse[]>();
  /** Nombre del financiador: para los nombres accesibles de la tabla y del pie. */
  readonly financiador = input.required<string>();
  /** La entrada esta vigente: solo entonces sus planes se editan o se dan de baja. */
  readonly editable = input(true);
  /** Plan con el panel lateral abierto, para marcar su fila. */
  readonly seleccionado = input<number | null | undefined>(null);

  readonly editar = output<PlanCatalogoResponse>();
  readonly baja = output<PlanCatalogoResponse>();

  protected readonly tabla = tablaLocal(this.planes, {
    columnas: {
      plan: (plan) => plan.nombre,
      vigencia: (plan) => plan.vigenciaDesde,
      estado: (plan) => plan.estado,
    },
  });
}
