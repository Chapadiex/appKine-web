import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { FranjaFueraDeHorarioResponse } from '../../../../api/generated/model/franja-fuera-de-horario-response';
import { RUTA_HORARIOS } from '../../../../core/models/rutas';
import { etiquetaDeDia } from '../../../../shared/utils/dias-de-la-semana';
import { rangoHorario } from '../../../../shared/utils/horas-de-pared';

/** Las franjas de un profesional, con su enlace al horario semanal. */
interface FranjasDeUnProfesional {
  readonly membershipId: number;
  readonly nombre: string;
  readonly franjas: readonly FranjaFueraDeHorarioResponse[];
}

/**
 * Las franjas de profesionales que el horario nuevo de la sede deja afuera (regla del
 * 08/11/2026: el horario del profesional queda dentro del de la sede, contrato 0.162.0).
 *
 * <p>Dos usos. En el <b>aviso</b> —el 409 `franjas-de-profesionales-fuera-del-horario`, antes de
 * guardar nada— lista qué queda afuera y en qué quedaría, y ofrece los dos caminos: recortarlas al
 * horario nuevo o guardar sin tocarlas y ajustar cada profesional a mano. En el <b>resultado</b>
 * —después de guardar conservándolas— queda la lista con el enlace a cada horario semanal.
 *
 * <p>Vive aparte de la pantalla del calendario para que su plantilla no cargue con esto.
 */
@Component({
  selector: 'app-franjas-fuera-del-horario',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styleUrl: '../../resource.css',
  styles: `
    .franjas-fuera__profesional {
      display: flex;
      flex-wrap: wrap;
      gap: var(--esp-3);
      align-items: baseline;
      margin: var(--esp-4) 0 var(--esp-2);
      font-weight: var(--peso-semi);
    }
  `,
  template: `
    <div class="aviso-apertura" role="status">
      @if (modo() === 'aviso') {
        <p>
          <b>{{ titulo() }}</b> El horario del profesional tiene que quedar dentro del horario de la
          sede. Todavía no se guardó nada.
        </p>
      } @else {
        <p>
          <b>{{ titulo() }}</b> La agenda igual no ofrece turnos fuera del horario de la sede.
          Ajustalas desde el horario de cada profesional.
        </p>
      }
      @for (profesional of porProfesional(); track profesional.membershipId) {
        <p class="franjas-fuera__profesional">
          {{ profesional.nombre }}
          <a
            class="enlace"
            [routerLink]="rutaHorarios"
            [queryParams]="{ membershipId: profesional.membershipId }"
            >Ajustar su horario</a
          >
        </p>
        <ul class="lista-datos" [attr.aria-label]="'Franjas de ' + profesional.nombre">
          @for (franja of profesional.franjas; track franja.bloqueId) {
            <li>{{ describir(franja) }}</li>
          }
        </ul>
      }
      @if (modo() === 'aviso') {
        <div class="acciones">
          <button type="button" class="boton" [disabled]="ocupado()" (click)="recortar.emit()">
            Recortarlas al nuevo horario
          </button>
          <button
            type="button"
            class="boton boton--secundario"
            [disabled]="ocupado()"
            (click)="conservar.emit()"
          >
            Guardar sin recortar y ajustar a mano
          </button>
          <button
            type="button"
            class="boton boton--secundario"
            [disabled]="ocupado()"
            (click)="cancelar.emit()"
          >
            Cancelar
          </button>
        </div>
      }
    </div>
  `,
})
export class FranjasFueraDelHorario {
  readonly franjas = input.required<readonly FranjaFueraDeHorarioResponse[]>();
  /** `aviso`: antes de guardar, con los tres botones. `resultado`: ya guardado, solo la lista. */
  readonly modo = input<'aviso' | 'resultado'>('aviso');
  readonly ocupado = input(false);

  readonly recortar = output();
  readonly conservar = output();
  readonly cancelar = output();

  protected readonly rutaHorarios = RUTA_HORARIOS;

  protected readonly titulo = computed(() => {
    const cantidad = this.franjas().length;
    const cuantas = cantidad === 1 ? 'Una franja' : `${cantidad} franjas`;
    return this.modo() === 'aviso'
      ? `${cuantas} de profesionales ${cantidad === 1 ? 'queda' : 'quedan'} fuera del horario nuevo.`
      : `${cuantas} de profesionales ${cantidad === 1 ? 'quedó' : 'quedaron'} fuera del horario de la sede.`;
  });

  protected readonly porProfesional = computed<FranjasDeUnProfesional[]>(() => {
    const grupos = new Map<number, FranjasDeUnProfesional>();
    for (const franja of this.franjas()) {
      const membershipId = franja.membershipId ?? 0;
      const grupo = grupos.get(membershipId) ?? {
        membershipId,
        nombre: franja.profesionalNombre ?? 'Profesional sin nombre',
        franjas: [],
      };
      grupos.set(membershipId, { ...grupo, franjas: [...grupo.franjas, franja] });
    }
    return [...grupos.values()];
  });

  /** "Sábado de 08:00 a 14:00: queda de 09:00 a 13:00" o "...: se da de baja". */
  protected describir(franja: FranjaFueraDeHorarioResponse): string {
    const actual = `${etiquetaDeDia(franja.diaSemana)} de ${rangoHorario(franja.horaDesde, franja.horaHasta)}`;
    const resultantes = franja.resultantes ?? [];
    if (resultantes.length === 0) {
      return this.modo() === 'aviso'
        ? `${actual}: queda entera afuera, recortarla la da de baja`
        : `${actual}: entera afuera`;
    }
    const tramos = resultantes
      .map((tramo) => `de ${rangoHorario(tramo.horaDesde, tramo.horaHasta)}`)
      .join(' y ');
    return this.modo() === 'aviso' ? `${actual}: quedaría ${tramos}` : `${actual}: entra ${tramos}`;
  }
}
