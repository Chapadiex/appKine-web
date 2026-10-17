import { EspacioHabilitadoEstadoEnum } from '../../../api/generated/model/espacio-habilitado';
import {
  admiteBaja,
  admiteCambios,
  admiteConfirmacion,
  diaEnPalabras,
  diasDeLaSemana,
  espaciosHabilitadosEnServicio,
  fechaDeSede,
  fechaHoraDeSede,
  horaDeSede,
  instanteDesdeHoraDeSede,
  lugaresLibres,
  lunesDeLaSemana,
  nombreDeClase,
  sumarDiasAFecha,
  textoDeEstadoDeClase,
  textoDeEstadoDeInscripcion,
  textoDeEventoDeClase,
} from './clases';

const CORDOBA = 'America/Argentina/Cordoba';

describe('clases: fechas en la zona de la sede', () => {
  it('convierte hora de pared de la sede a UTC y vuelve', () => {
    const instante = instanteDesdeHoraDeSede('2026-10-14', '18:30', CORDOBA);
    expect(instante).toBe('2026-10-14T21:30:00.000Z');
    expect(fechaDeSede(instante ?? '', CORDOBA)).toBe('2026-10-14');
    expect(horaDeSede(instante ?? '', CORDOBA)).toBe('18:30');
  });

  it('la medianoche de la sede ya es otro dia en UTC y no se corre', () => {
    const instante = instanteDesdeHoraDeSede('2026-10-14', '22:00', CORDOBA);
    expect(instante).toBe('2026-10-15T01:00:00.000Z');
    expect(fechaDeSede(instante ?? '', CORDOBA)).toBe('2026-10-14');
  });

  it('respeta un cambio de horario (Madrid, ultimo domingo de octubre)', () => {
    expect(instanteDesdeHoraDeSede('2026-07-01', '10:00', 'Europe/Madrid')).toBe(
      '2026-07-01T08:00:00.000Z',
    );
    expect(instanteDesdeHoraDeSede('2026-11-02', '10:00', 'Europe/Madrid')).toBe(
      '2026-11-02T09:00:00.000Z',
    );
  });

  it('rechaza fecha u hora invalidas y tolera instantes vacios', () => {
    expect(instanteDesdeHoraDeSede('14/10/2026', '10:00', CORDOBA)).toBeNull();
    expect(instanteDesdeHoraDeSede('2026-10-14', '10', CORDOBA)).toBeNull();
    expect(fechaDeSede(undefined, CORDOBA)).toBe('');
    expect(fechaDeSede('no-es-fecha', CORDOBA)).toBe('');
    expect(horaDeSede('', CORDOBA)).toBe('');
    expect(horaDeSede('no-es-fecha', CORDOBA)).toBe('');
    expect(fechaHoraDeSede(undefined, CORDOBA)).toBe('');
  });

  it('una zona invalida cae a la del navegador sin romper', () => {
    expect(fechaDeSede('2026-10-14T15:00:00Z', 'Zona/Inexistente')).toMatch(/^2026-10-1[45]$/);
  });

  it('arma la semana de lunes a domingo', () => {
    expect(lunesDeLaSemana('2026-10-14')).toBe('2026-10-12');
    expect(lunesDeLaSemana('2026-10-18')).toBe('2026-10-12');
    expect(lunesDeLaSemana('2026-10-12')).toBe('2026-10-12');
    expect(diasDeLaSemana('2026-10-12')).toHaveLength(7);
    expect(diasDeLaSemana('2026-10-26').at(-1)).toBe('2026-11-01');
    expect(sumarDiasAFecha('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('nombra el dia y la hora', () => {
    expect(diaEnPalabras('2026-10-14')).toBe('miércoles 14/10');
    expect(diaEnPalabras('raro')).toBe('raro');
    expect(fechaHoraDeSede('2026-10-14T21:30:00Z', CORDOBA)).toBe('miércoles 14/10, 18:30');
  });
});

describe('clases: estados y reglas de la pantalla', () => {
  it('etiqueta estados y eventos, y conserva lo desconocido', () => {
    expect(textoDeEstadoDeClase('EN_CURSO')).toBe('En curso');
    expect(textoDeEstadoDeClase('NUEVO')).toBe('NUEVO');
    expect(textoDeEstadoDeClase(undefined)).toBe('Sin estado');
    expect(textoDeEstadoDeInscripcion('LISTA_ESPERA')).toBe('En lista de espera');
    expect(textoDeEstadoDeInscripcion(undefined)).toBe('Sin estado');
    expect(textoDeEventoDeClase('REPROGRAMACION')).toBe('Reprogramada');
    expect(textoDeEventoDeClase(undefined)).toBe('Evento');
  });

  it('solo una clase programada admite cambios', () => {
    expect(admiteCambios({ estado: 'PROGRAMADA' })).toBe(true);
    expect(admiteCambios({ estado: 'CANCELADA' })).toBe(false);
    expect(admiteCambios(null)).toBe(false);
  });

  it('baja y confirmacion segun el estado de la inscripcion', () => {
    expect(admiteBaja({ estado: 'LISTA_ESPERA' })).toBe(true);
    expect(admiteBaja({ estado: 'ASISTIO' })).toBe(false);
    expect(admiteConfirmacion({ estado: 'RESERVADA' })).toBe(true);
    expect(admiteConfirmacion({ estado: 'CONFIRMADA' })).toBe(false);
  });

  it('lugares libres nunca negativos', () => {
    expect(lugaresLibres({ capacidadEfectiva: 8, ocupados: 3 })).toBe(5);
    expect(lugaresLibres({ capacidad: 2, ocupados: 3 })).toBe(0);
    expect(lugaresLibres({})).toBe(0);
  });
});

describe('nombreDeClase y espaciosHabilitadosEnServicio', () => {
  it('nombra por titulo, despues por oferta y al final por id', () => {
    expect(nombreDeClase({ id: 1, titulo: 'Yoga', ofertaNombre: 'Pilates' })).toBe('Yoga');
    expect(nombreDeClase({ id: 1, ofertaNombre: 'Pilates' })).toBe('Pilates');
    expect(nombreDeClase({ id: 1 })).toBe('Clase #1');
  });

  it('ofrece solo las habilitaciones activas y en servicio, con nombre de respaldo', () => {
    expect(
      espaciosHabilitadosEnServicio({
        espacios: [
          { espacioId: 9, nombre: 'Sala grande', estado: EspacioHabilitadoEstadoEnum.ACTIVO },
          { espacioId: 10, estado: EspacioHabilitadoEstadoEnum.ACTIVO, enServicio: true },
          { espacioId: 11, estado: EspacioHabilitadoEstadoEnum.ACTIVO, enServicio: false },
          { espacioId: 12, estado: EspacioHabilitadoEstadoEnum.INACTIVO },
        ],
      }),
    ).toEqual([
      { espacioId: 9, nombre: 'Sala grande' },
      { espacioId: 10, nombre: 'Box #10' },
    ]);
  });
});
