import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
  linkedSignal,
} from '@angular/core';

import { Icono } from '../icono/icono';

let siguienteId = 0;

/**
 * Barra de filtros de un listado (UX-01, regla de filtros del plan §3.4).
 *
 * <p><b>Lo basico a la vista, lo demas a un clic.</b> Arriba va un solo campo, el que se usa
 * siempre —la busqueda por texto cuando el listado la tiene—, y al lado un boton con un embudo
 * que despliega hacia abajo los filtros avanzados. Cada filtro visible que no se usa es ruido que
 * el operador lee todos los dias.
 *
 * <p><b>Un filtro activo nunca queda escondido sin aviso.</b> `activos` es cuantos filtros
 * avanzados estan fuera de su valor por defecto: el boton lo muestra como contador, y el panel
 * llega desplegado si hay alguno (al volver a la pantalla, o con la URL compartida). Despues lo
 * decide el usuario: el panel no se cierra solo cuando el contador vuelve a cero.
 *
 * <p><b>Proyeccion.</b> El campo basico va con el atributo `filtro-principal`; todo lo demas es el
 * contenido del panel. Sin campo basico (un listado sin busqueda), `soloAvanzados` muestra el
 * boton con su texto: un embudo solo, sin nada al lado, no se entiende.
 *
 * <p><b>No sabe de dominio.</b> No conoce los filtros: los recibe ya armados por la pantalla.
 */
@Component({
  selector: 'akine-filtros, app-filtros',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icono],
  template: `
    <div class="filtros-barra__fila">
      <div class="filtros-barra__principal">
        <ng-content select="[filtro-principal]" />
      </div>
      <button
        type="button"
        class="filtros-barra__boton"
        [class.filtros-barra__boton--con-texto]="soloAvanzados()"
        [attr.aria-expanded]="abiertos()"
        [attr.aria-controls]="idPanel"
        (click)="abiertos.set(!abiertos())"
      >
        <app-icono nombre="filtro" />
        @if (soloAvanzados()) {
          <span>Filtros</span>
        } @else {
          <span class="visualmente-oculto">Filtros avanzados</span>
        }
        @if (activos() > 0) {
          <span class="filtros-barra__contador">
            {{ activos() }}<span class="visualmente-oculto"> activos</span>
          </span>
        }
      </button>
    </div>
    <div class="filtros-barra__avanzados" [id]="idPanel" [hidden]="!abiertos()">
      <ng-content />
    </div>
  `,
  host: { class: 'filtros-barra' },
})
export class Filtros {
  /** Cuantos filtros avanzados estan fuera de su valor por defecto. */
  readonly activos = input(0);

  /** El listado no tiene campo basico: el boton lleva texto y va solo. */
  readonly soloAvanzados = input(false, { transform: booleanAttribute });

  /** Desplegado si llega con filtros activos; despues, lo que decida el usuario. */
  protected readonly abiertos = linkedSignal<number, boolean>({
    source: this.activos,
    computation: (activos, anterior) => (anterior?.value ?? false) || activos > 0,
  });

  protected readonly idPanel = `filtros-${siguienteId++}`;
}
