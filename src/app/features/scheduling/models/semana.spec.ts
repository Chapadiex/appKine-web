import {
  agruparPorDia,
  diaEnZona,
  diasDeLaSemana,
  esFecha,
  lunesDe,
  rotuloDeSemana,
} from './semana';

describe('semana del calendario', () => {
  it('la semana va de lunes a domingo: el domingo es el último día, no el primero', () => {
    expect(lunesDe('2026-10-26')).toBe('2026-10-26');
    expect(lunesDe('2026-10-28')).toBe('2026-10-26');
    expect(lunesDe('2026-11-01')).toBe('2026-10-26');
    expect(diasDeLaSemana('2026-10-26')).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
    expect(rotuloDeSemana('2026-10-26')).toBe('26 de octubre al 1 de noviembre de 2026');
  });

  it('reparte cada turno en el día de la SEDE, no en el de UTC', () => {
    // 01:30Z del martes son las 22:30 del lunes en Cordoba.
    const tarde = { turno: { id: 1, inicio: '2026-10-27T01:30:00Z' } };
    const martes = { turno: { id: 2, inicio: '2026-10-27T12:00:00Z' } };
    const fuera = { turno: { id: 3, inicio: '2026-11-03T12:00:00Z' } };
    const zona = 'America/Argentina/Cordoba';

    expect(diaEnZona(tarde.turno.inicio, zona)).toBe('2026-10-26');
    // Sin zona conocida, UTC: es lo que la pantalla rotula.
    expect(diaEnZona(tarde.turno.inicio, '')).toBe('2026-10-27');

    const dias = agruparPorDia([tarde, martes, fuera], diasDeLaSemana('2026-10-26'), zona);
    expect(dias[0].turnos).toEqual([tarde]);
    expect(dias[1].turnos).toEqual([martes]);
    expect(dias.flatMap((d) => d.turnos)).not.toContain(fuera);
  });

  it('solo acepta fechas reales como semana de la URL', () => {
    expect(esFecha('2026-10-26')).toBe(true);
    expect(esFecha('2026-02-30')).toBe(false);
    expect(esFecha('cualquiera')).toBe(false);
    expect(esFecha('')).toBe(false);
  });
});
