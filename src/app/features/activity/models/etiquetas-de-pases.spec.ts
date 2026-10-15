import {
  avisoDeConsumo,
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
  it('un pase ACTIVO fuera de vigencia se lee vencido', () => {
    expect(etiquetaDeEstadoDePase({ estado: Estado.ACTIVO, vigente: true })).toBe('Activo');
    expect(etiquetaDeEstadoDePase({ estado: Estado.ACTIVO, vigente: false })).toBe('Vencido');
    expect(etiquetaDeEstadoDePase({ estado: Estado.AGOTADO })).toBe('Agotado');
    expect(etiquetaDeEstadoDePase({})).toBe('Sin estado');
    expect(claseDeEstadoDePase({ estado: Estado.ACTIVO })).toContain('activa');
    expect(claseDeEstadoDePase({ estado: Estado.AGOTADO })).toContain('suspendida');
    expect(claseDeEstadoDePase({ estado: Estado.ACTIVO, vigente: false })).toContain('revocada');
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
