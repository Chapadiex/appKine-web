/**
 * Lo que ya se sabe de un turno antes de pedir nada (TURNO - Tecnico §2).
 *
 * <p>Es la unica diferencia entre los puntos de entrada: la agenda sabe fecha, hora y profesional; un
 * plan sabe paciente, caso, plan y prestacion. El formulario pregunta solo lo que falta y las reglas
 * son siempre las mismas, las del backend.
 *
 * <p>Vive en `core` porque lo arman varias features —person, clinical, resource— y el flujo lo dibuja
 * `scheduling`. Son ids y nada mas: los nombres los lee el flujo, para no arrastrar datos viejos.
 */
export interface ContextoDeTurno {
  /** Desde donde se inicio. Solo trazabilidad: no cambia ninguna regla. */
  readonly origen: OrigenDeTurno;
  readonly personaId?: number;
  readonly casoId?: number;
  readonly planId?: number;
  readonly ofertaId?: number;
  readonly profesionalId?: number;
  readonly espacioId?: number;
  /** Dia a partir del cual buscar horarios, `YYYY-MM-DD`. */
  readonly fecha?: string;
  /** Instante elegido, UTC. Con esto no se busca: se valida ese horario. */
  readonly inicio?: string;
}

export type OrigenDeTurno =
  | 'AGENDA'
  | 'DISPONIBILIDAD'
  | 'PACIENTE'
  | 'CASO'
  | 'PLAN'
  | 'PROFESIONAL'
  | 'SESION'
  | 'LISTA_DE_ESPERA'
  | 'TURNO_ANTERIOR';

/** Lo que el flujo de turnos tiene que mostrar. Una sola cosa a la vez. */
export type SolicitudDeTurnos =
  | { readonly tipo: 'nuevo'; readonly contexto: ContextoDeTurno }
  | { readonly tipo: 'multiple'; readonly contexto: ContextoDeTurno }
  | { readonly tipo: 'detalle'; readonly turnoId: number }
  | { readonly tipo: 'espera'; readonly contexto: ContextoDeTurno }
  | { readonly tipo: 'bloqueo'; readonly contexto: ContextoDeTurno };
