import { formatearImporte, leerImporte, reformatearImporte } from './importe-en-texto';

describe('importe en texto', () => {
  it('lee el formato argentino y el de calculadora', () => {
    expect(leerImporte('10.000.000')).toBe(10000000);
    expect(leerImporte('8.500,50')).toBe(8500.5);
    expect(leerImporte('10000')).toBe(10000);
    expect(leerImporte('10000.5')).toBe(10000.5);
    expect(leerImporte('$ 12.000')).toBe(12000);
  });

  it('vacío o basura no son un importe', () => {
    expect(leerImporte('')).toBeNull();
    expect(leerImporte('   ')).toBeNull();
    expect(leerImporte('diez')).toBeNull();
    expect(leerImporte('1,2,3')).toBeNull();
  });

  it('muestra miles con punto y decimales con coma', () => {
    expect(formatearImporte(10000000)).toBe('10.000.000,00');
    expect(formatearImporte(8500.5)).toBe('8.500,50');
    expect(formatearImporte(null)).toBe('');
  });

  it('al salir del campo reescribe lo que entiende y deja lo que no', () => {
    expect(reformatearImporte('10000000')).toBe('10.000.000,00');
    expect(reformatearImporte('abc')).toBe('abc');
  });
});
