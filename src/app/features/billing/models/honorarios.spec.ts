import {
  agruparPorOferta,
  importeDelGrupo,
  motivoDeExclusionEnPalabras,
  parteEnPalabras,
} from './honorarios';

describe('honorarios por clase', () => {
  it('agrupa por oferta, conserva el orden y suma en centavos exactos', () => {
    const grupos = agruparPorOferta([
      { claseId: 1, ofertaId: 31, ofertaNombre: 'Pilates', importeColaborador: 0.1, moneda: 'ARS' },
      { claseId: 2, ofertaId: 32, ofertaNombre: 'Yoga', importeColaborador: 250 },
      { claseId: 3, ofertaId: 31, ofertaNombre: 'Pilates', importeColaborador: 0.2 },
      { claseId: 4, importeColaborador: 999 },
    ]);
    expect(grupos.map((g) => g.ofertaId)).toEqual([31, 32]);
    expect(grupos[0].claseIds).toEqual([1, 3]);
    // 0.1 + 0.2 en coma flotante no es 0.3; en centavos si.
    expect(importeDelGrupo(grupos[0])).toBe(0.3);
    expect(grupos[0].moneda).toBe('ARS');
  });

  it('sin nombre de oferta usa el id', () => {
    expect(agruparPorOferta([{ claseId: 1, ofertaId: 9 }])[0].ofertaNombre).toBe('Oferta #9');
  });

  it('cada motivo de exclusion tiene su texto', () => {
    expect(motivoDeExclusionEnPalabras('YA_LIQUIDADA')).toContain('Ya liquidada');
    expect(motivoDeExclusionEnPalabras('SIN_HONORARIO')).toContain('tarifa');
    expect(motivoDeExclusionEnPalabras('SIN_PRESENTES')).toContain('presente');
    expect(motivoDeExclusionEnPalabras('SIN_IMPORTE')).toContain('cero');
    expect(motivoDeExclusionEnPalabras('OTRO')).toBe('OTRO');
    expect(motivoDeExclusionEnPalabras(undefined)).toBe('');
  });

  it('dice que parte del reparto le toca', () => {
    expect(parteEnPalabras({ instructores: 1 })).toBe('Unico instructor');
    expect(parteEnPalabras({})).toBe('Unico instructor');
    expect(parteEnPalabras({ instructores: 2, posicion: 2 })).toBe('Parte 2 de 2');
    expect(parteEnPalabras({ instructores: 3 })).toBe('Parte ? de 3');
  });
});
