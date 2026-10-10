import { conceptoEnPalabras, importeEnPalabras } from './etiquetas-de-obligacion';

describe('conceptoEnPalabras', () => {
  it('traduce los tres conceptos de F-4 y no inventa uno cuando no vino', () => {
    expect(conceptoEnPalabras('PARTICULAR')).toBe('Particular');
    expect(conceptoEnPalabras('COSEGURO')).toBe('Coseguro');
    expect(conceptoEnPalabras('FINANCIADOR')).toBe('A cargo de la obra social');
    expect(conceptoEnPalabras(undefined)).toBe('');
  });
});

/**
 * Formateo de importes de la cuenta corriente (M18, AKINE-07.01).
 *
 * <p>Solo comportamiento. Lo que se afirma es lo que puede estar mal de una forma que nadie note:
 * la moneda equivocada, los centavos perdidos, y la pantalla entera caida por un codigo de moneda
 * que el navegador no conoce.
 */
describe('importeEnPalabras', () => {
  it('usa la moneda que vino en la respuesta, no una cableada', () => {
    // El mismo numero con dos monedas tiene que dar dos textos distintos. Si estuviera cableado
    // 'ARS', el simbolo diria una cosa y el importe seria de otra: la peor forma de estar mal,
    // porque nada falla.
    const enPesos = importeEnPalabras(3000, 'ARS');
    const enDolares = importeEnPalabras(3000, 'USD');

    expect(enPesos).toContain('3.000,00');
    expect(enDolares).toContain('3.000,00');
    expect(enPesos).not.toBe(enDolares);
  });

  it('siempre muestra los dos decimales, aunque el importe venga redondo', () => {
    // `8500` y `8500.00` son el mismo `number`. Sin los decimales fijos, una columna de plata
    // mezcla "8.500" con "8.500,50" y deja de poder compararse de un vistazo.
    expect(importeEnPalabras(8500, 'ARS')).toContain('8.500,00');
    expect(importeEnPalabras(1234.5, 'ARS')).toContain('1.234,50');
  });

  it('no rompe la pantalla con un codigo de moneda que el navegador no conoce', () => {
    // `Intl.NumberFormat` lanza `RangeError` con un codigo invalido. Una cuenta corriente que se
    // cae entera por un campo mal cargado es peor que una que muestra el numero sin simbolo.
    const texto = importeEnPalabras(1500, 'PESOS');

    expect(texto).toContain('1.500,00');
  });

  it('sin moneda formatea igual el numero, y sin importe devuelve vacio', () => {
    expect(importeEnPalabras(1500, undefined)).toContain('1.500,00');
    // Vacio y no "0": el contrato declara los importes opcionales, y un cero inventado en una
    // deuda es un dato falso, no un dato faltante.
    expect(importeEnPalabras(undefined, 'ARS')).toBe('');
  });
});
