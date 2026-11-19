import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { Icono } from '../icono/icono';

/** De a cuánto mueven las flechas: da el nombre accesible de los botones. */
export type UnidadDeNavegacion = 'dia' | 'semana' | 'mes';

const NOMBRES: Record<UnidadDeNavegacion, { anterior: string; siguiente: string }> = {
  dia: { anterior: 'Día anterior', siguiente: 'Día siguiente' },
  semana: { anterior: 'Semana anterior', siguiente: 'Semana siguiente' },
  mes: { anterior: 'Mes anterior', siguiente: 'Mes siguiente' },
};

/**
 * Navegador de fecha único de la aplicación (rediseño 19/11/2026): ‹ Hoy › y el período en palabras.
 *
 * <p>No sabe de fechas: la pantalla calcula el período y decide qué hacer con cada evento. El
 * período se anuncia con `aria-live="polite"`; si la pantalla ya lo muestra en otro control (un
 * selector de fecha proyectado), `periodoVisible = false` lo deja sólo para el lector de pantalla.
 * El contenido proyectado (un `input type="date"`, un rótulo que abre el calendario) va al final.
 */
@Component({
  selector: 'app-navegador-de-fecha',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icono],
  styleUrl: './navegador-de-fecha.css',
  host: { role: 'group', '[attr.aria-label]': 'etiqueta()' },
  template: `
    <button
      type="button"
      class="navegador-de-fecha__boton navegador-de-fecha__boton--flecha"
      [title]="nombres().anterior"
      (click)="anterior.emit()"
    >
      <app-icono nombre="chevron-izquierda" /><span class="visualmente-oculto">{{
        nombres().anterior
      }}</span>
    </button>
    @if (mostrarHoy()) {
      <button type="button" class="navegador-de-fecha__boton" (click)="hoy.emit()">Hoy</button>
    }
    <button
      type="button"
      class="navegador-de-fecha__boton navegador-de-fecha__boton--flecha"
      [title]="nombres().siguiente"
      (click)="siguiente.emit()"
    >
      <app-icono nombre="chevron-derecha" /><span class="visualmente-oculto">{{
        nombres().siguiente
      }}</span>
    </button>
    @if (periodo()) {
      <span
        class="navegador-de-fecha__periodo"
        [class.visualmente-oculto]="!periodoVisible()"
        aria-live="polite"
        >{{ periodo() }}</span
      >
    }
    <ng-content />
  `,
})
export class NavegadorDeFecha {
  /** Nombre del grupo para el lector de pantalla ("Fecha de la agenda"). */
  readonly etiqueta = input('Fecha');
  /** El período a la vista en palabras ("lunes 3 de marzo", "marzo de 2030"). */
  readonly periodo = input('');
  readonly periodoVisible = input(true);
  readonly unidad = input<UnidadDeNavegacion>('dia');
  readonly mostrarHoy = input(true);

  readonly anterior = output<void>();
  readonly siguiente = output<void>();
  readonly hoy = output<void>();

  protected readonly nombres = computed(() => NOMBRES[this.unidad()]);
}
