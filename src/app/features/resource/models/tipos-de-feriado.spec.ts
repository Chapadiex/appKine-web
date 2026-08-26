import { etiquetaDeTipoDeFeriado } from './tipos-de-feriado';

/**
 * Spec de las etiquetas del tipo de feriado.
 *
 * <p>El contrato publica `tipo` como texto libre, asi que <b>nada</b> del lado del compilador
 * verifica esta tabla: si el `CHECK` de la migracion suma un valor, lo unico que evita que la
 * columna quede en blanco es la degradacion al codigo crudo.
 */
describe('etiquetaDeTipoDeFeriado', () => {
  it('traduce los cinco valores que declara la migracion', () => {
    expect(etiquetaDeTipoDeFeriado('INAMOVIBLE')).toBe('Inamovible');
    expect(etiquetaDeTipoDeFeriado('TRASLADABLE')).toBe('Trasladable');
    expect(etiquetaDeTipoDeFeriado('PUENTE')).toBe('Puente');
    expect(etiquetaDeTipoDeFeriado('NO_LABORABLE')).toBe('No laborable');
    expect(etiquetaDeTipoDeFeriado('RELIGIOSO')).toBe('Religioso');
  });

  it('un tipo desconocido se muestra crudo, no desaparece de la fila', () => {
    expect(etiquetaDeTipoDeFeriado('TIPO_NUEVO')).toBe('TIPO_NUEVO');
  });

  it('sin tipo la celda dice un guion y no "undefined"', () => {
    expect(etiquetaDeTipoDeFeriado(undefined)).toBe('-');
    expect(etiquetaDeTipoDeFeriado('')).toBe('-');
  });
});
