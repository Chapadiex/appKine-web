import { describe, expect, it } from 'vitest';

import { marcaDePlan } from './contratacion';

describe('marcaDePlan', () => {
  it('da la sigla y el color de cada escalón', () => {
    expect(marcaDePlan('BASICO')).toEqual({
      sigla: 'PB',
      texto: 'Básico',
      clase: 'marca-plan--base',
    });
    expect(marcaDePlan('CRECIMIENTO').sigla).toBe('PC');
    expect(marcaDePlan('RED').clase).toBe('marca-plan--red');
  });

  it('prefiere el nombre que manda el backend', () => {
    expect(marcaDePlan('RED', '  Red de sedes ').texto).toBe('Red de sedes');
  });

  it('un plan desconocido queda sin sigla y con su código', () => {
    expect(marcaDePlan('ESPECIAL')).toEqual({
      sigla: '',
      texto: 'ESPECIAL',
      clase: 'marca-plan--otro',
    });
  });

  it('sin plan', () => {
    expect(marcaDePlan(undefined)).toEqual({
      sigla: '',
      texto: 'Sin plan',
      clase: 'marca-plan--otro',
    });
  });
});
