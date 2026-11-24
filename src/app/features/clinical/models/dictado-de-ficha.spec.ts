import { interpretarDictadoDeFicha } from './dictado-de-ficha';

describe('interpretarDictadoDeFicha', () => {
  it('reparte un dictado recorriendo la pantalla', () => {
    const ficha = interpretarDictadoDeFicha(
      'Ocupación, programador, peso 140 kilos, altura 1,84 m. Actividad física, generalmente ' +
        'sedentario, realiza caminatas 2 o 3 veces por semana. Tiene hipertensión y no aplica ' +
        'nada más. Antecedentes. Algo quirúrgico, se operó la rodilla en el 2020 y no trajo ' +
        'ningún estudio aparte.',
    );

    expect(ficha).toEqual({
      ocupacion: 'Programador',
      pesoKg: 140,
      alturaCm: 184,
      actividad: 'SEDENTARIO',
      detalle: 'Realiza caminatas 2 o 3 veces por semana',
      condiciones: ['HIPERTENSION'],
      antecedentes: [
        { tipo: 'QUIRURGICO', descripcion: 'Se operó la rodilla', anio: 2020, zona: 'Rodilla' },
      ],
    });
  });

  it('toma la actividad sin que se la nombre y no carga los rótulos como datos', () => {
    const ficha = interpretarDictadoDeFicha(
      'La persona es albañil, ocupación albañil, peso 120 kilos, altura 1 metro 90, deportista, ' +
        'realiza 3 veces por semana fútbol, tiene marcapasos y epilepsia. Antecedentes médicos, ' +
        'no tiene ninguno, quirúrgicos, pero la mano derecha en el 20-25.',
    );

    expect(ficha).toEqual({
      ocupacion: 'Albañil',
      pesoKg: 120,
      alturaCm: 190,
      actividad: 'DEPORTISTA',
      detalle: 'Realiza 3 veces por semana fútbol',
      condiciones: ['MARCAPASOS', 'EPILEPSIA'],
      antecedentes: [
        {
          tipo: 'QUIRURGICO',
          descripcion: 'Operación de la mano derecha',
          anio: 2025,
          zona: 'Mano',
        },
      ],
    });
  });

  it('carga las condiciones fuera de la lista y las observaciones', () => {
    const ficha = interpretarDictadoDeFicha(
      'Tiene marcapasos, TDAH y celiaquía. Observaciones: viene con su madre, no maneja.',
    );

    expect(ficha.condiciones).toEqual(['MARCAPASOS']);
    expect(ficha.antecedentes).toEqual([
      { tipo: 'MEDICO', descripcion: 'TDAH' },
      { tipo: 'MEDICO', descripcion: 'Celiaquía' },
      { tipo: 'OTRO', descripcion: 'Viene con su madre, no maneja' },
    ]);
  });

  it('no toma una condición negada ni inventa lo que no se dijo', () => {
    const ficha = interpretarDictadoDeFicha(
      'Peso 72,5. Tiene diabetes, no tiene asma. Antecedentes: alérgico a la penicilina.',
    );

    expect(ficha.pesoKg).toBe(72.5);
    expect(ficha.alturaCm).toBeUndefined();
    expect(ficha.ocupacion).toBeUndefined();
    expect(ficha.condiciones).toEqual(['DIABETES']);
    expect(ficha.antecedentes).toEqual([
      { tipo: 'ALERGIA', descripcion: 'Alérgico a la penicilina' },
    ]);
  });
});
