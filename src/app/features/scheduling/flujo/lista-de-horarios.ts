import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { HorarioDisponible } from '../../../api/generated/model/horario-disponible';
import { fechaEnPalabras, horaEnZona, hoyEnZona, sumarDias } from '../models/etiquetas-de-agenda';
import { diaEnZona } from '../models/semana';

/**
 * Los proximos horarios, agrupados por dia (TURNO - Tecnico §13). Es presentacional: la misma lista
 * sirve para reservar, para reprogramar y para las alternativas de un conflicto.
 */
@Component({
  selector: 'app-lista-de-horarios',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './flujo.css',
  template: `
    <div class="horarios">
      @for (dia of dias(); track dia.fecha) {
        <div>
          <h4 class="horarios__dia">{{ dia.rotulo }}</h4>
          <ul class="horarios__lista">
            @for (horario of dia.horarios; track claveDe(horario)) {
              <li>
                <button
                  type="button"
                  class="horario"
                  [attr.aria-pressed]="esElegido(horario)"
                  (click)="elegir.emit(horario)"
                >
                  <span class="horario__hora">{{ hora(horario) }}</span>
                  <span class="horario__detalle">{{ detalle(horario) }}</span>
                </button>
              </li>
            }
          </ul>
        </div>
      }
    </div>
  `,
})
export class ListaDeHorarios {
  readonly horarios = input.required<readonly HorarioDisponible[]>();
  readonly timezone = input.required<string>();
  readonly elegido = input<HorarioDisponible | null>(null);
  readonly elegir = output<HorarioDisponible>();

  protected readonly dias = computed(() => {
    const zona = this.timezone();
    const hoy = hoyEnZona(zona);
    const manana = sumarDias(hoy, 1);
    const porDia = new Map<string, HorarioDisponible[]>();
    for (const horario of this.horarios()) {
      const fecha = diaEnZona(horario.desde, zona);
      porDia.set(fecha, [...(porDia.get(fecha) ?? []), horario]);
    }
    return [...porDia.entries()].map(([fecha, horarios]) => ({
      fecha,
      horarios,
      rotulo: fecha === hoy ? 'Hoy' : fecha === manana ? 'Mañana' : fechaEnPalabras(fecha),
    }));
  });

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

  protected hora(horario: HorarioDisponible): string {
    return `${horaEnZona(horario.desde, this.timezone())} a ${horaEnZona(horario.hasta, this.timezone())}`;
  }

  protected detalle(horario: HorarioDisponible): string {
    return [horario.profesionalNombre, horario.espacioNombre].filter(Boolean).join(' · ');
  }
}
