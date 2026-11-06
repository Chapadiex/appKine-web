import { describe, expect, it } from 'vitest';

import { alternarDia, describirDias, diasDelModo } from './dias-rapidos';

/**
 * Los modos de seleccion rapida y su redaccion. Lo que importa: que "lunes a viernes" sean
 * exactamente los cinco dias ISO, que el personalizado no fije ninguno, y que el aviso del
 * resultado diga los dias como los dice una persona.
 */
describe('dias-rapidos', () => {
  it('cada modo fija sus dias y el personalizado no fija ninguno', () => {
    expect(diasDelModo('lv')).toEqual([1, 2, 3, 4, 5]);
    expect(diasDelModo('ls')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(diasDelModo('semana')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(diasDelModo('personalizado')).toBeNull();
  });

  it('alternar agrega o quita el dia y deja la lista ordenada y sin repetir', () => {
    expect(alternarDia([1, 5], 3)).toEqual([1, 3, 5]);
    expect(alternarDia([1, 3, 5], 3)).toEqual([1, 5]);
    expect(alternarDia([], 7)).toEqual([7]);
  });

  it('redacta los dias como los dice una persona', () => {
    expect(describirDias([1, 2, 3, 4, 5])).toBe('lunes a viernes');
    expect(describirDias([1, 2, 3, 4, 5, 6, 7])).toBe('toda la semana');
    expect(describirDias([1, 3, 5])).toBe('lunes, miercoles y viernes');
    expect(describirDias([2, 3])).toBe('martes y miercoles');
    expect(describirDias([7])).toBe('domingo');
    expect(describirDias([])).toBe('');
  });
});
