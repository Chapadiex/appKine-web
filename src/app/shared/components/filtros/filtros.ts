import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  linkedSignal,
  output,
  ViewEncapsulation,
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
 * <p><b>Proyeccion.</b> El campo basico va con el atributo `filtro-principal`; los filtros que se
 * usan todo el tiempo (fecha, profesional, estado) van a la vista con `filtro-frecuente`; todo lo
 * demas es el contenido del panel.
 *
 * <p><b>Toolbar de la tabla (UX-14).</b> Una sola fila pegada a la tabla: "[Buscar…] [Filtros 2]
 * 37 resultados". El boton dice siempre "Filtros" (con texto en todas las pantallas), y el contador
 * de resultados vive en la misma fila que la busqueda que lo produce.
 *
 * <p><b>No sabe de dominio.</b> No conoce los filtros: los recibe ya armados por la pantalla.
 */
@Component({
  selector: 'akine-filtros, app-filtros',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './filtros.css',
  imports: [Icono],
  template: `
    <div class="filtros-barra__fila">
      <div class="filtros-barra__principal">
        <ng-content select="[filtro-principal]" />
      </div>
      <ng-content select="[filtro-frecuente]" />
      @if (!sinAvanzados()) {
        <button
          type="button"
          class="filtros-barra__boton"
          [attr.aria-expanded]="abiertos()"
          [attr.aria-controls]="idPanel"
          (click)="abiertos.set(!abiertos())"
        >
          <app-icono nombre="filtro" />
          <span>Filtros</span>
          @if (activos() > 0) {
            <span class="filtros-barra__contador">
              {{ activos() }}<span class="visualmente-oculto"> activos</span>
            </span>
          }
        </button>
      }
      @if (textoResultados(); as texto) {
        <p class="filtros-barra__resultados" aria-live="polite">{{ texto }}</p>
      }
    </div>
    @if (!sinAvanzados()) {
      <div class="filtros-barra__avanzados" [id]="idPanel" [hidden]="!abiertos()">
        <ng-content />
        @if (limpiable() && activos() > 0) {
          <div class="filtros-barra__limpiar">
            <button
              type="button"
              class="boton boton--secundario boton--chico"
              (click)="limpiar.emit()"
            >
              Limpiar filtros
            </button>
          </div>
        }
      </div>
    }
  `,
  host: { class: 'filtros-barra' },
})
export class Filtros {
  /** Cuantos filtros avanzados estan fuera de su valor por defecto. */
  readonly activos = input(0);

  /**
   * Compatibilidad: antes el boton era solo un embudo cuando habia busqueda. Desde UX-14 dice
   * "Filtros" siempre, asi que ya no cambia nada.
   */
  readonly soloAvanzados = input(false, { transform: booleanAttribute });

  /** El listado no tiene filtros avanzados: solo la busqueda (y los frecuentes) y el contador. */
  readonly sinAvanzados = input(false, { transform: booleanAttribute });

  /** Cuantas filas devuelve el listado con lo elegido. `null` mientras carga o si no se sabe. */
  readonly resultados = input<number | null>(null);

  /** Como se nombran las filas: [singular, plural]. Default "resultado" / "resultados". */
  readonly unidad = input<readonly [string, string]>(['resultado', 'resultados']);

  /** Ofrece "Limpiar filtros" en el panel cuando hay alguno activo; avisa con `limpiar`. */
  readonly limpiable = input(false, { transform: booleanAttribute });

  /** El usuario pidio volver todos los filtros avanzados a su valor por defecto. */
  readonly limpiar = output<void>();

  protected readonly textoResultados = computed(() => {
    const n = this.resultados();
    if (n === null) return null;
    const [singular, plural] = this.unidad();
    return `${n} ${n === 1 ? singular : plural}`;
  });

  /** Desplegado si llega con filtros activos; despues, lo que decida el usuario. */
  protected readonly abiertos = linkedSignal<number, boolean>({
    source: this.activos,
    computation: (activos, anterior) => (anterior?.value ?? false) || activos > 0,
  });

  protected readonly idPanel = `filtros-${siguienteId++}`;
}
