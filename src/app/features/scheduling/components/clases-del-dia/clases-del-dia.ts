import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { EventoDeAgenda } from '../../../../api/generated/model/evento-de-agenda';
import { horaEnZona } from '../../models/etiquetas-de-agenda';
import { ErrorAgenda, traducirErrorAgenda } from '../../models/agenda-errors';
import { SchedulingApi } from '../../services/scheduling-api';

/** Estados de una clase, tal como los publica la agenda unificada. */
const ESTADOS: Readonly<Record<string, string>> = {
  PROGRAMADA: 'Programada',
  EN_CURSO: 'En curso',
  REALIZADA: 'Realizada',
  CANCELADA: 'Cancelada',
};

/**
 * Las clases grupales del dia, dentro de la recepcion (M12, RF-M12-013, AKINE-08.01).
 *
 * <p>Una clase no es un turno y no pasa por la recepcion de turnos: no tiene llegada ni validacion
 * de cobertura por persona. Por eso va en un bloque propio, debajo, con su cupo y un enlace al
 * detalle de la clase —que vive en la feature `activity`, a la que se llega por URL—. La agenda
 * unificada no expone participantes: quien vino se ve en la clase.
 *
 * <p>La recepcion solo la monta con `clase:read`: sin el permiso el enlace llevaria a un 403.
 */
@Component({
  selector: 'app-clases-del-dia',
  imports: [RouterLink],
  templateUrl: './clases-del-dia.html',
})
export class ClasesDelDia {
  private readonly api = inject(SchedulingApi);

  readonly consultorioId = input.required<number>();
  /** Dia local de la sede, `YYYY-MM-DD`. */
  readonly fecha = input.required<string>();

  protected readonly clases = signal<readonly EventoDeAgenda[] | null>(null);
  protected readonly timezone = signal('');
  protected readonly error = signal<ErrorAgenda | null>(null);

  constructor() {
    effect(() => {
      const consultorioId = this.consultorioId();
      const fecha = this.fecha();
      untracked(() => this.cargar(consultorioId, fecha));
    });
  }

  protected cargar(consultorioId = this.consultorioId(), fecha = this.fecha()): void {
    if (fecha === '') {
      return;
    }
    this.clases.set(null);
    this.error.set(null);
    this.api.clasesDelDia(consultorioId, fecha).subscribe({
      next: (respuesta) => {
        if (fecha !== this.fecha() || consultorioId !== this.consultorioId()) {
          return;
        }
        this.timezone.set(respuesta.timezone);
        this.clases.set(respuesta.clases);
      },
      error: (error: unknown) => this.error.set(traducirErrorAgenda(error)),
    });
  }

  protected rango(clase: EventoDeAgenda): string {
    return `${horaEnZona(clase.inicio, this.timezone())} a ${horaEnZona(clase.fin, this.timezone())}`;
  }

  protected nombre(clase: EventoDeAgenda): string {
    return clase.titulo || clase.ofertaNombre || `Clase #${clase.eventoId}`;
  }

  protected estado(clase: EventoDeAgenda): string {
    return ESTADOS[clase.estado ?? ''] ?? clase.estado ?? '';
  }
}
