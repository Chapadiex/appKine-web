import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { TurnoAfectadoPorDisponibilidadResponse } from '../../../../api/generated/model/turno-afectado-por-disponibilidad-response';
import { formatearInstante } from '../../../../shared/utils/instantes';
import { etiquetaDeFecha, sumarDias } from '../../models/ventana-de-fechas';
import {
  ImpactoPrevio,
  notaDeListaRecortada,
  resumenDeImpacto,
} from '../../models/turnos-afectados';

/**
 * Lo que la consulta previa de impacto anticipa, dentro del panel de confirmacion (A-11).
 *
 * <p>Lo usan el horario semanal y las excepciones: las dos pantallas consultan endpoints
 * distintos pero reciben la misma `ImpactoDisponibilidadResponse`, y el cartel tiene que decir
 * lo mismo en las dos.
 *
 * <p><b>La lista no trae datos del paciente</b>: el contrato los omite a proposito. Cada fila
 * es una fecha y una franja, y el detalle se abre en la agenda.
 */
@Component({
  selector: 'app-impacto-previo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../resource.css',
  template: `
    @if (estado(); as actual) {
      <div class="aviso-apertura" role="status">
        @switch (actual.tipo) {
          @case ('consultando') {
            <p>Calculando cuantos turnos pendientes quedarian fuera de horario...</p>
          }
          @case ('error') {
            <p>
              <b>No pudimos calcular de antemano cuantos turnos quedan afuera.</b> Podes confirmar
              igual: ningun turno se cancela ni se mueve, pero vas a tener que revisarlos en la
              agenda.
            </p>
          }
          @case ('listo') {
            <p>
              <b>Turnos afectados: {{ cantidad() }}.</b> {{ resumen() }}
            </p>
            @if (turnos().length > 0) {
              <ul class="lista-datos">
                @for (turno of turnos(); track turno.turnoId) {
                  <li>
                    {{ franja(turno) }}
                    @if (nombreDe(); as nombre) {
                      · {{ nombre(turno.membershipId) }}
                    }
                  </li>
                }
              </ul>
            }
            @if (nota(); as texto) {
              <p class="ayuda">{{ texto }}</p>
            }
            @if (ultimoDia(); as dia) {
              <p class="ayuda">
                Se revisaron los turnos hasta el {{ dia }} inclusive: la consulta mira como mucho
                noventa dias hacia adelante.
              </p>
            }
          }
        }
      </div>
    }
  `,
})
export class ImpactoPrevioPanel {
  /** `null` no dibuja nada: todavia no se pidio la consulta. */
  readonly estado = input.required<ImpactoPrevio | null>();

  /**
   * Nombre del profesional de un turno, para la excepcion de sede, que alcanza a varios.
   * `null` en el horario semanal, donde todos los turnos son del profesional elegido.
   */
  readonly nombreDe = input<((membershipId: number | undefined) => string) | null>(null);

  private readonly impacto = computed(() => {
    const estado = this.estado();
    return estado?.tipo === 'listo' ? estado.impacto : null;
  });

  protected readonly cantidad = computed(() => this.impacto()?.turnosAfectados ?? 0);
  protected readonly resumen = computed(() => {
    const impacto = this.impacto();
    return impacto === null ? '' : resumenDeImpacto(impacto);
  });
  protected readonly turnos = computed(() => this.impacto()?.turnos ?? []);
  protected readonly nota = computed(() => {
    const impacto = this.impacto();
    return impacto === null ? null : notaDeListaRecortada(impacto);
  });

  /** `evaluadoHasta` es exclusivo: el ultimo dia mirado es el anterior. */
  protected readonly ultimoDia = computed(() => {
    const hasta = this.impacto()?.evaluadoHasta;
    if (hasta === undefined || hasta === null || hasta === '') {
      return null;
    }
    const ultimo = sumarDias(hasta, -1);
    return ultimo === '' ? null : etiquetaDeFecha(ultimo);
  });

  protected franja(turno: TurnoAfectadoPorDisponibilidadResponse): string {
    const inicio = formatearInstante(turno.inicio) ?? 'Sin fecha';
    const fin = horaDe(turno.fin);
    return fin === null ? inicio : `${inicio} a ${fin}`;
  }
}

function horaDe(instante: string | undefined): string | null {
  if (instante === undefined || instante === '') {
    return null;
  }
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) {
    return null;
  }
  return fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}
