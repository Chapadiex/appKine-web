import { Injectable, signal } from '@angular/core';

/** Una pregunta que otra pantalla le pasa al asistente flotante (por ejemplo, desde la ayuda). */
export interface PreguntaPendiente {
  readonly texto: string;
  /** Distingue dos pedidos iguales seguidos. */
  readonly numero: number;
}

/**
 * Puente entre features sin importarse entre sí (ADR-0004): el manual pide «preguntale al asistente»
 * y el asistente flotante se abre con la pregunta escrita.
 */
@Injectable({ providedIn: 'root' })
export class PreguntaAlAsistenteStore {
  private readonly actual = signal<PreguntaPendiente | null>(null);
  private contador = 0;

  readonly pendiente = this.actual.asReadonly();

  preguntar(texto: string): void {
    this.actual.set({ texto, numero: ++this.contador });
  }

  atendida(): void {
    this.actual.set(null);
  }
}
