import { EventoDeTurno } from '../../../api/generated/model/evento-de-turno';

import {
  esTerminal,
  estadoSegunHistorial,
  fechaHoraEnZona,
  horarioSegunHistorial,
  textoDeEstado,
  textoDeEvento,
} from './etiquetas-de-turno';

/**
 * Spec de los textos y las lecturas derivadas del turno (M12, AKINE-05.03).
 *
 * <p>Cubre <b>lo que decide comportamiento</b> y nada mas: que el estado y el horario vigentes se
 * reconstruyan bien desde el historial —que es la unica lectura de un turno que el contrato
 * publica— y que cancelado y ausente no se confundan.
 */
describe('etiquetas de turno', () => {
  /** Reserva a las 12:00Z, reprogramado a las 15:00Z, despues confirmado. En ese orden. */
  const HISTORIAL: readonly EventoDeTurno[] = [
    {
      id: 1,
      tipo: 'RESERVA',
      estadoNuevo: 'RESERVADO',
      inicioNuevo: '2026-09-15T12:00:00Z',
      finNuevo: '2026-09-15T12:45:00Z',
      ocurridoEn: '2026-09-01T14:03:11Z',
    },
    {
      id: 2,
      tipo: 'REPROGRAMACION',
      estadoAnterior: 'CONFIRMADO',
      estadoNuevo: 'RESERVADO',
      inicioAnterior: '2026-09-15T12:00:00Z',
      inicioNuevo: '2026-09-22T15:00:00Z',
      finNuevo: '2026-09-22T15:45:00Z',
      motivo: 'El profesional pidio el dia',
      ocurridoEn: '2026-09-12T09:00:00Z',
    },
    {
      id: 3,
      tipo: 'CONFIRMACION',
      estadoAnterior: 'RESERVADO',
      estadoNuevo: 'CONFIRMADO',
      ocurridoEn: '2026-09-12T09:05:00Z',
    },
  ] as EventoDeTurno[];

  it('el estado vigente es el del ultimo evento, no el de la reserva', () => {
    expect(estadoSegunHistorial(HISTORIAL)).toBe('CONFIRMADO');
  });

  it('el horario vigente lo fija la reprogramacion, aunque el ultimo evento no lo traiga', () => {
    // La confirmacion no mueve el horario y no publica ninguno. Quedarse con el ultimo evento a
    // secas mostraria el turno sin hora; quedarse con el primero lo mostraria en el dia viejo.
    expect(horarioSegunHistorial(HISTORIAL)).toEqual({
      inicio: '2026-09-22T15:00:00Z',
      fin: '2026-09-22T15:45:00Z',
    });
  });

  it('sin eventos no inventa un estado ni un horario', () => {
    // Suponer RESERVADO habilitaria botones sobre un turno que la pantalla no pudo leer.
    expect(estadoSegunHistorial([])).toBe('');
    expect(horarioSegunHistorial([])).toEqual({ inicio: '', fin: '' });
  });

  it('cancelado y ausente dicen cosas distintas: uno libera el lugar y el otro no', () => {
    expect(textoDeEstado('CANCELADO')).toContain('libero');
    expect(textoDeEstado('AUSENTE')).toContain('la hora se consumio igual');
    expect(esTerminal('CANCELADO')).toBe(true);
    expect(esTerminal('AUSENTE')).toBe(true);
    expect(esTerminal('RESERVADO')).toBe(false);
    expect(esTerminal('CONFIRMADO')).toBe(false);
  });

  it('un estado o un tipo que este cliente no conoce se muestra crudo, nunca en blanco', () => {
    // El contrato puede sumar uno sin romper nada. Una celda vacia se lee como "no tiene estado".
    expect(textoDeEstado('EN_SALA')).toBe('EN_SALA');
    expect(textoDeEvento('LLEGADA')).toBe('LLEGADA');
    expect(textoDeEstado(undefined)).toBe('Estado desconocido');
  });

  it('formatea el instante en la zona de la sede y cae en UTC cuando no la sabe', () => {
    // 12:00Z son las 09:00 en Cordoba. Formatear con la zona del navegador correria el historial
    // entero sin que nada falle.
    expect(fechaHoraEnZona('2026-09-15T12:00:00Z', 'America/Argentina/Cordoba')).toContain('09:00');
    expect(fechaHoraEnZona('2026-09-15T12:00:00Z', '')).toContain('12:00');
    expect(fechaHoraEnZona('2026-09-15T12:00:00Z', 'Marte/Olympus')).toContain('12:00');
    expect(fechaHoraEnZona(undefined, 'UTC')).toBe('');
    expect(fechaHoraEnZona('no es una fecha', 'UTC')).toBe('');
  });
});
