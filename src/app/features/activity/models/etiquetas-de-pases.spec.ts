import {
  avisoDeConsumo,
  avisoDeVigencia,
  esAbono,
  etiquetaDeTipoDePase,
  cantidadConSigno,
  claseDeEstadoDePase,
  creditosEnPalabras,
  etiquetaDeEstadoDePase,
  etiquetaDeMovimiento,
  importeDePase,
  origenDeMovimiento,
} from './etiquetas-de-pases';
import { ConsumoDeCreditoEfectoEnum as Efecto } from '../../../api/generated/model/consumo-de-credito';
import {
  MovimientoPaseOrigenTipoEnum as Origen,
  MovimientoPaseTipoEnum as Tipo,
} from '../../../api/generated/model/movimiento-pase';
import { PaseEstadoEnum as Estado } from '../../../api/generated/model/pase';

describe('etiquetas de pases', () => {
  it('el estado es el que escribe el backend; VENCIDO lo pone el job (08.07)', () => {
    expect(etiquetaDeEstadoDePase({ estado: Estado.ACTIVO, vigente: true })).toBe('Activo');
    expect(etiquetaDeEstadoDePase({ estado: Estado.ACTIVO, vigente: false })).toBe('Activo');
    expect(etiquetaDeEstadoDePase({ estado: Estado.VENCIDO })).toBe('Vencido');
    expect(etiquetaDeEstadoDePase({ estado: Estado.ANULADO })).toBe('Anulado');
    expect(etiquetaDeEstadoDePase({ estado: Estado.AGOTADO })).toBe('Agotado');
    expect(etiquetaDeEstadoDePase({})).toBe('Sin estado');
    expect(claseDeEstadoDePase({ estado: Estado.ACTIVO })).toContain('activa');
    expect(claseDeEstadoDePase({ estado: Estado.AGOTADO })).toContain('suspendida');
    expect(claseDeEstadoDePase({ estado: Estado.VENCIDO })).toContain('revocada');
  });

  it('un ACTIVO que no cubre hoy explica por que', () => {
    const hoy = '2026-10-14';
    expect(avisoDeVigencia({ estado: Estado.ACTIVO, vigente: true }, hoy)).toBeNull();
    expect(avisoDeVigencia({ estado: Estado.VENCIDO, vigente: false }, hoy)).toBeNull();
    expect(
      avisoDeVigencia({ estado: Estado.ACTIVO, vigente: false, vigenciaDesde: '2026-11-01' }, hoy),
    ).toBe('Empieza el 01/11/2026');
    expect(
      avisoDeVigencia({ estado: Estado.ACTIVO, vigente: false, vigenciaHasta: '2026-10-13' }, hoy),
    ).toContain('Termino su vigencia');
    expect(avisoDeVigencia({ estado: Estado.ACTIVO, vigente: false }, hoy)).toBe(
      'No cubre clases hoy',
    );
    expect(esAbono({ tipo: 'ABONO' })).toBe(true);
    expect(etiquetaDeTipoDePase({})).toBe('Pack');
    expect(etiquetaDeTipoDePase({ tipo: 'ABONO' })).toBe('Abono');
  });

  it('el movimiento se explica con tipo, signo y origen (CA-M29-009-06)', () => {
    expect(etiquetaDeMovimiento({ tipo: Tipo.CONSUMO })).toBe('Consumo');
    expect(etiquetaDeMovimiento({})).toBe('Movimiento');
    expect(origenDeMovimiento({ origenTipo: Origen.ASISTENCIA })).toBe('asistencia a una clase');
    expect(origenDeMovimiento({})).toBe('');
    expect(cantidadConSigno(8)).toBe('+8');
    expect(cantidadConSigno(-1)).toBe('-1');
    expect(cantidadConSigno(undefined)).toBe('');
    expect(creditosEnPalabras(1)).toBe('1 credito');
    expect(creditosEnPalabras(5)).toBe('5 creditos');
    expect(creditosEnPalabras(undefined)).toBe('');
  });

  it('el importe usa la moneda del dato y no se rompe con una invalida', () => {
    expect(importeDePase(40000, 'ARS')).toContain('40.000');
    expect(importeDePase(10, 'XX!')).toBe('10,00');
    expect(importeDePase(undefined, 'ARS')).toBe('');
  });

  it('el aviso de consumo no dice nada cuando no aplica', () => {
    expect(avisoDeConsumo({ efecto: Efecto.CONSUMIDO, saldo: 1 })).toContain('le quedan 1 credito');
    expect(avisoDeConsumo({ efecto: Efecto.DEVUELTO, saldo: 8 })).toContain(
      'ahora tiene 8 creditos',
    );
    expect(avisoDeConsumo({ efecto: Efecto.SIN_PASE_ELEGIBLE })).toContain(
      'quedo registrada igual',
    );
    expect(avisoDeConsumo({ efecto: Efecto.NO_APLICA })).toBeNull();
    expect(avisoDeConsumo(undefined)).toBeNull();
  });
});
