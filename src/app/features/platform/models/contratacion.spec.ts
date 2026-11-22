import { describe, expect, it } from 'vitest';

import { marcaDePlan } from './contratacion';

describe('marcaDePlan', () => {
  it('da la sigla y el color de cada escalón', () => {
    expect(marcaDePlan('BASE')).toEqual({
      sigla: 'PB',
      texto: 'Plan Base',
      clase: 'marca-plan--base',
    });
    expect(marcaDePlan('CRECIMIENTO').sigla).toBe('PI');
    expect(marcaDePlan('RED')).toEqual({
      sigla: 'PP',
      texto: 'Plan Plus',
      clase: 'marca-plan--red',
    });
  });

  it('un escalón conocido lleva su nombre fijo aunque el backend mande otro', () => {
    expect(marcaDePlan('RED', '  Red de sedes ').texto).toBe('Plan Plus');
  });

  it('un plan desconocido usa el nombre que manda el backend', () => {
    expect(marcaDePlan('ESPECIAL', '  A medida ').texto).toBe('A medida');
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
