import { TEXTO_TIPO, TipoNotificacion, textoEstado, textoTipo } from './notificaciones';

describe('textos de notificacion', () => {
  it('los avisos de pases de 08.08 (0.116.0) se leen en espanol, no como el literal', () => {
    expect(textoTipo(TipoNotificacion.PASE_POR_VENCER)).toBe('Pase o abono por vencer');
    expect(textoTipo(TipoNotificacion.PASE_SALDO_BAJO)).toBe('Pase con pocos creditos');
  });

  it('todo tipo del contrato tiene su texto', () => {
    for (const tipo of Object.values(TipoNotificacion)) {
      expect(TEXTO_TIPO[tipo]).toBeTruthy();
      expect(textoTipo(tipo)).not.toBe(tipo);
    }
  });

  it('sin tipo ni estado muestra un guion', () => {
    expect(textoTipo(undefined)).toBe('-');
    expect(textoEstado(undefined)).toBe('-');
  });
});
