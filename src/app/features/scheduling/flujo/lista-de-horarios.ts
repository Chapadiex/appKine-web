import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { HorarioDisponible } from '../../../api/generated/model/horario-disponible';
import { Icono } from '../../../shared/components/icono/icono';
import { fechaEnPalabras, horaEnZona, hoyEnZona, sumarDias } from '../models/etiquetas-de-agenda';
import { diaEnZona } from '../models/semana';

/**
 * Los proximos horarios, agrupados por dia (TURNO - Tecnico §13). Es presentacional: la misma lista
 * sirve para reservar, para reprogramar y para las alternativas de un conflicto.
 *
 * <p><b>Rediseño del 08/11/2026.</b> Cada dia dice cuantos horarios tiene y, si todos son del mismo
 * profesional, lo nombra una vez en su encabezado; cada horario muestra solo la hora de inicio (y
 * el profesional cuando cambia de uno a otro). Libre es neutro; el elegido, azul con tilde. Con
 * `limitePrimerDia` / `limiteOtrosDias` cada dia muestra pocos y ofrece "Ver todos los horarios".
 */
@Component({
  selector: 'app-lista-de-horarios',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icono],
  styleUrl: './flujo.css',
  template: `
    <div class="horarios">
      @for (dia of dias(); track dia.fecha; let primero = $first) {
        <section class="horarios__grupo" [attr.aria-label]="dia.rotulo">
          <h4 class="horarios__dia">
            <span class="horarios__fecha">{{ dia.rotulo }}</span>
            <span class="horarios__cantidad">
              {{ dia.horarios.length }}
              {{ dia.horarios.length === 1 ? 'horario disponible' : 'horarios disponibles' }}
            </span>
            @if (dia.profesional; as profesional) {
              <span class="horarios__profesional">{{ profesional }}</span>
            }
          </h4>
          <ul class="horarios__lista">
            @for (horario of visibles(dia, primero); track claveDe(horario)) {
              <li>
                <button
                  type="button"
                  class="horario"
                  [attr.aria-pressed]="esElegido(horario)"
                  (click)="elegir.emit(horario)"
                >
                  @if (esElegido(horario)) {
                    <app-icono class="horario__tilde" nombre="tilde" />
                  }
                  <span class="horario__hora">{{ inicio(horario) }}</span>
                  <span class="visualmente-oculto">{{ resto(horario) }}</span>
                  @if (!dia.profesional && detalle(horario); as quien) {
                    <span class="horario__detalle" aria-hidden="true">{{ quien }}</span>
                  }
                </button>
              </li>
            }
          </ul>
          @if (ocultos(dia, primero) > 0) {
            <button type="button" class="horarios__ver-todos" (click)="expandir(dia.fecha)">
              Ver todos los horarios ({{ dia.horarios.length }})
            </button>
          }
        </section>
      }
    </div>
  `,
})
export class ListaDeHorarios {
  readonly horarios = input.required<readonly HorarioDisponible[]>();
  readonly timezone = input.required<string>();
  readonly elegido = input<HorarioDisponible | null>(null);
  /** Cuantos horarios muestra el primer dia antes de "Ver todos"; `null` = todos. */
  readonly limitePrimerDia = input<number | null>(null);
  /** Lo mismo para los dias siguientes. */
  readonly limiteOtrosDias = input<number | null>(null);
  readonly elegir = output<HorarioDisponible>();

  private readonly expandidos = signal<ReadonlySet<string>>(new Set());

  protected readonly dias = computed(() => {
    const zona = this.timezone();
    const hoy = hoyEnZona(zona);
    const manana = sumarDias(hoy, 1);
    const porDia = new Map<string, HorarioDisponible[]>();
    for (const horario of this.horarios()) {
      const fecha = diaEnZona(horario.desde, zona);
      porDia.set(fecha, [...(porDia.get(fecha) ?? []), horario]);
    }
    return [...porDia.entries()].map(([fecha, horarios]) => {
      const nombres = new Set(horarios.map((h) => this.detalle(h)));
      const [unico] = nombres;
      return {
        fecha,
        horarios,
        rotulo: fecha === hoy ? 'Hoy' : fecha === manana ? 'Mañana' : fechaEnPalabras(fecha),
        // Un solo profesional (y box) en todo el dia: se dice una vez, no en cada horario.
        profesional: nombres.size === 1 && unico ? unico : null,
      };
    });
  });

  protected visibles(
    dia: { fecha: string; horarios: readonly HorarioDisponible[] },
    primero: boolean,
  ): readonly HorarioDisponible[] {
    const limite = this.limiteDe(dia, primero);
    if (limite === null) {
      return dia.horarios;
    }
    const recortados = dia.horarios.slice(0, limite);
    // El elegido sigue a la vista aunque haya quedado despues del corte.
    const elegido = dia.horarios.find((h) => this.esElegido(h));
    return elegido !== undefined && !recortados.includes(elegido)
      ? [...recortados, elegido]
      : recortados;
  }

  protected ocultos(
    dia: { fecha: string; horarios: readonly HorarioDisponible[] },
    primero: boolean,
  ): number {
    return dia.horarios.length - this.visibles(dia, primero).length;
  }

  protected expandir(fecha: string): void {
    this.expandidos.update((actuales) => new Set([...actuales, fecha]));
  }

  private limiteDe(dia: { fecha: string }, primero: boolean): number | null {
    if (this.expandidos().has(dia.fecha)) {
      return null;
    }
    return primero ? this.limitePrimerDia() : this.limiteOtrosDias();
  }

  protected claveDe(horario: HorarioDisponible): string {
    return `${horario.desde}-${horario.profesionalId}`;
  }

  protected esElegido(horario: HorarioDisponible): boolean {
    const elegido = this.elegido();
    return (
      elegido !== null &&
      elegido.desde === horario.desde &&
      elegido.profesionalId === horario.profesionalId
    );
  }

  protected inicio(horario: HorarioDisponible): string {
    return horaEnZona(horario.desde, this.timezone());
  }

  /** Lo que la vista no repite y el lector de pantalla si necesita: el fin y quien atiende. */
  protected resto(horario: HorarioDisponible): string {
    const fin = horario.hasta ? ` a ${horaEnZona(horario.hasta, this.timezone())}` : '';
    const quien = this.detalle(horario);
    return `${fin}${quien ? `, ${quien}` : ''}`;
  }

  protected detalle(horario: HorarioDisponible): string {
    return [horario.profesionalNombre, horario.espacioNombre].filter(Boolean).join(' · ');
  }
}
