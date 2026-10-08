import {
  crearFranjasForm,
  erroresDeFranjasDelServidor,
  indicesSolapados,
} from './franjas-semanales';

describe('franjas-semanales', () => {
  it('tocarse en un extremo no es solaparse; pisarse el mismo dia si', () => {
    expect(
      indicesSolapados([
        { diaSemana: 1, horaDesde: '09:00', horaHasta: '12:00' },
        { diaSemana: 1, horaDesde: '12:00', horaHasta: '24:00' },
        { diaSemana: 2, horaDesde: '10:00', horaHasta: '11:00' },
      ]).size,
    ).toBe(0);

    expect([
      ...indicesSolapados([
        { diaSemana: 1, horaDesde: '09:00', horaHasta: '12:00' },
        { diaSemana: 2, horaDesde: '09:00', horaHasta: '12:00' },
        { diaSemana: 1, horaDesde: '11:00', horaHasta: '13:00' },
      ]),
    ]).toEqual([0, 2]);
  });

  it('una franja que cierra antes de abrir es invalida; 24:00 es un cierre valido', () => {
    const lista = crearFranjasForm([
      { diaSemana: 1, horaDesde: '18:00', horaHasta: '09:00' },
      { diaSemana: 2, horaDesde: '20:00', horaHasta: '24:00' },
    ]);
    expect(lista.at(0).hasError('rango')).toBe(true);
    expect(lista.at(1).valid).toBe(true);
  });

  it('agrupa los errores del 400 por indice de fila, quedandose con el primero', () => {
    const errores = erroresDeFranjasDelServidor({
      name: 'El nombre es obligatorio',
      'horarioGeneral[2].horaDesde': 'Formato invalido',
      'horarioGeneral[2].horaHasta': 'Otro',
      'primerBox.name': 'Muy largo',
    });
    expect([...errores.entries()]).toEqual([[2, 'Formato invalido']]);
  });
});
