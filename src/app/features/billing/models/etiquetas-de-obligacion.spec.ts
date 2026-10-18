import {
  conceptoEnPalabras,
  conceptoDeClase,
  esDeClase,
  esDeVenta,
  importeEnPalabras,
  origenEnPalabras,
} from './etiquetas-de-obligacion';
import { Obligacion, ObligacionOrigenEnum } from '../../../api/generated/model/obligacion';

describe('origenEnPalabras', () => {
  it('rotula las ventas (sin sesion) y deja vacio el caso normal', () => {
    expect(origenEnPalabras('VENTA_PASE')).toBe('Venta de pase');
    expect(origenEnPalabras('VENTA_ABONO')).toBe('Venta de abono');
    expect(origenEnPalabras('SESION')).toBe('');
    expect(origenEnPalabras(undefined)).toBe('');
  });
});

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

describe('esDeVenta', () => {
  it('marca como de venta solo los dos origenes de venta, igual que el backend', () => {
    const con = (origen: ObligacionOrigenEnum | undefined): Obligacion => ({ origen });

    expect(esDeVenta(con(ObligacionOrigenEnum.VENTA_PASE))).toBe(true);
    expect(esDeVenta(con(ObligacionOrigenEnum.VENTA_ABONO))).toBe(true);
    expect(esDeVenta(con(ObligacionOrigenEnum.SESION))).toBe(false);
    // U-39: la deuda de una clase asistida se anula por DELETE /obligaciones, como la de sesion.
    expect(esDeVenta(con(ObligacionOrigenEnum.ASISTENCIA_CLASE))).toBe(false);
    // Sin origen es una deuda anterior a M29, o sea de una sesion: se sigue anulando aca.
    expect(esDeVenta(con(undefined))).toBe(false);
  });
});

describe('deuda de una clase asistida (U-39)', () => {
  it('se reconoce por el origen y no es de venta', () => {
    expect(esDeClase({ origen: ObligacionOrigenEnum.ASISTENCIA_CLASE })).toBe(true);
    expect(esDeClase({ origen: ObligacionOrigenEnum.SESION })).toBe(false);
    expect(esDeClase({})).toBe(false);
    expect(origenEnPalabras('ASISTENCIA_CLASE')).toBe('Clase asistida');
  });

  it('el concepto lleva el dia de la clase en la zona de la sede, no el del navegador', () => {
    // 01:30 UTC del 21 son las 22:30 del 20 en Cordoba.
    expect(conceptoDeClase('2026-10-21T01:30:00Z', 'America/Argentina/Cordoba')).toBe(
      'Clase del 20/10',
    );
    expect(conceptoDeClase('2026-10-21T01:30:00Z', 'UTC')).toBe('Clase del 21/10');
  });

  it('sin la fecha de la clase dice "Clase asistida" y no inventa una', () => {
    expect(conceptoDeClase(undefined)).toBe('Clase asistida');
    expect(conceptoDeClase('no-es-fecha')).toBe('Clase asistida');
  });
});
