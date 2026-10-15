import { Injectable, computed, signal } from '@angular/core';

import { Justificacion } from './historia-clinica-api';

/**
 * Estado de UNA visita a la Historia Clinica de una persona: la historia, sus casos y sus planes.
 *
 * <p>No es `providedIn: 'root'` a proposito. La provee {@link VisitaClinicaPage}, el marco de las
 * rutas `historia-clinica/personas/:personaId/...`, asi que vive lo que vive ese marco: pasar de la
 * historia a un caso y de ahi al plan es la misma visita y el motivo declarado se conserva; salir a
 * la ficha, recargar o cambiar de contexto la termina, y el motivo se vuelve a pedir (DP-03).
 * Recordarlo entre visitas convertiria el control en un formalismo.
 *
 * <p>El motivo vive solo en memoria: nunca en la URL, ni en `localStorage`, ni en la consola.
 */
@Injectable()
export class VisitaClinica {
  private readonly persona = signal<number | null>(null);
  private readonly justificacion = signal<Justificacion>(null);

  /** La persona de la visita. `null` mientras el marco no la leyo de la URL. */
  readonly personaId = this.persona.asReadonly();

  /** El motivo declarado, o `null` si no hizo falta (hay relacion asistencial) o no se pidio. */
  readonly motivo = this.justificacion.asReadonly();

  /** La ficha administrativa de la persona: el camino de vuelta es uno solo. */
  readonly rutaFicha = computed(() => `/pacientes/${this.persona() ?? ''}`);

  /** La historia de la persona, raiz de la visita. */
  readonly rutaHistoria = computed(() => `/historia-clinica/personas/${this.persona() ?? ''}`);

  /** Empieza una visita nueva: otra persona u otro contexto. Lo de antes no se reutiliza. */
  iniciar(personaId: number): void {
    this.persona.set(personaId);
    this.justificacion.set(null);
  }

  /** El motivo que escribio quien mira. Vacio no es un motivo: se ignora. */
  declarar(motivo: string): void {
    const limpio = motivo.trim();
    if (limpio !== '') {
      this.justificacion.set(limpio);
    }
  }

  rutaCaso(casoId: number): string {
    return `${this.rutaHistoria()}/casos/${casoId}`;
  }

  rutaPlan(casoId: number): string {
    return `${this.rutaCaso(casoId)}/plan`;
  }
}
