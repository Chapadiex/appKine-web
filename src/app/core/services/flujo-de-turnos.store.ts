import { Injectable, signal } from '@angular/core';

import { ContextoDeTurno, SolicitudDeTurnos } from '../models/contexto-de-turno';

/**
 * La puerta de entrada al flujo unico de turnos (TURNO - Tecnico §1 y §3).
 *
 * <p>Cualquier pantalla pide "nuevo turno" o "ver este turno" con lo que ya sabe, sin importar la
 * feature `scheduling`, que sigue siendo lazy (ADR-0004). El shell escucha la solicitud y monta el
 * panel en su propio chunk. Es chico a proposito: vive en la carga inicial.
 *
 * <p>`cambios` sube cada vez que el flujo toca un turno: las pantallas que muestran turnos lo escuchan
 * y releen en su lugar, sin perder fecha, filtros ni scroll (TURNO - Tecnico §86 a §88).
 */
@Injectable({ providedIn: 'root' })
export class FlujoDeTurnosStore {
  private readonly actual = signal<SolicitudDeTurnos | null>(null);
  private readonly contador = signal(0);

  readonly solicitud = this.actual.asReadonly();
  readonly cambios = this.contador.asReadonly();

  nuevoTurno(contexto: ContextoDeTurno): void {
    this.actual.set({ tipo: 'nuevo', contexto });
  }

  programacionMultiple(contexto: ContextoDeTurno): void {
    this.actual.set({ tipo: 'multiple', contexto });
  }

  verTurno(turnoId: number): void {
    this.actual.set({ tipo: 'detalle', turnoId });
  }

  listaDeEspera(contexto: ContextoDeTurno): void {
    this.actual.set({ tipo: 'espera', contexto });
  }

  bloqueoDeAgenda(contexto: ContextoDeTurno): void {
    this.actual.set({ tipo: 'bloqueo', contexto });
  }

  cerrar(): void {
    this.actual.set(null);
  }

  notificarCambio(): void {
    this.contador.update((valor) => valor + 1);
  }
}
