import {
  ESTADOS_DE_ITEM,
  claseDeEstadoDeItem,
  detalleDeEstadoDeItem,
  esDebitable,
  estadoDeItemEnPalabras,
  hallazgoEnPalabras,
} from './etiquetas-de-presentacion';
import { PresentacionItemEstadoEnum } from '../../../api/generated/model/presentacion-item';
import { ReparoDePresentacionHallazgoEnum } from '../../../api/generated/model/reparo-de-presentacion';

/** Rotulos de M21 que agrego DP-37: reparos documentales y debito parcial. */
describe('etiquetas de presentación', () => {
  it('cada estado del item del contrato tiene rotulo propio y esta en el filtro', () => {
    for (const estado of Object.values(PresentacionItemEstadoEnum)) {
      expect(estadoDeItemEnPalabras(estado)).not.toBe(estado);
      expect(ESTADOS_DE_ITEM).toContain(estado);
    }
    expect(estadoDeItemEnPalabras('DEBITADO_PARCIAL')).toBe('Debitada en parte');
    expect(estadoDeItemEnPalabras('ACEPTADO_PARCIAL')).toBe('Aceptada en parte');
    expect(estadoDeItemEnPalabras(undefined)).toBe('');
  });

  it('la pastilla separa lo cobrado, lo perdido y lo que sigue abierto', () => {
    expect(claseDeEstadoDeItem('ACEPTADO_PARCIAL')).toContain('--activa');
    expect(claseDeEstadoDeItem('ACEPTADO')).toContain('--activa');
    expect(claseDeEstadoDeItem('DEBITADO')).toContain('--revocada');
    expect(claseDeEstadoDeItem('ANULADO')).toContain('--revocada');
    expect(claseDeEstadoDeItem('DEBITADO_PARCIAL')).toContain('--suspendida');
    expect(claseDeEstadoDeItem('INCLUIDO')).toContain('--suspendida');
  });

  it('el detalle explica que pasa con la deuda en los estados que no se explican solos', () => {
    expect(detalleDeEstadoDeItem('DEBITADO_PARCIAL')).toContain('Sigue en el lote');
    expect(detalleDeEstadoDeItem('ACEPTADO_PARCIAL')).toContain('vuelve a la bandeja');
    expect(detalleDeEstadoDeItem('DEBITADO')).toContain('Salio del lote');
    expect(detalleDeEstadoDeItem('INCLUIDO')).toBe('');
  });

  it('solo lo INCLUIDO se debita: el parcial ya tiene su debito', () => {
    expect(esDebitable({ estado: PresentacionItemEstadoEnum.INCLUIDO })).toBe(true);
    expect(esDebitable({ estado: PresentacionItemEstadoEnum.DEBITADO_PARCIAL })).toBe(false);
  });

  it('cada hallazgo del contrato tiene texto, y los documentales mandan a la ficha', () => {
    for (const hallazgo of Object.values(ReparoDePresentacionHallazgoEnum)) {
      expect(hallazgoEnPalabras(hallazgo)).not.toBe(hallazgo);
    }
    expect(hallazgoEnPalabras('SIN_ORDEN')).toContain('ficha del paciente');
    expect(hallazgoEnPalabras('SIN_AUTORIZACION')).toContain('ficha del paciente');
    expect(hallazgoEnPalabras('CREDENCIAL_FALTANTE')).toContain('No impide presentar');
  });
});
