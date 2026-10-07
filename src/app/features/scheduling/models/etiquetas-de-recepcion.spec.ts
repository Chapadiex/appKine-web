import { RecepcionEstadoEnum } from '../../../api/generated/model/recepcion';
import { recepcionAbierta, textoDeModalidad, textoDeRecepcion } from './etiquetas-de-recepcion';
import { textoDeEstado } from './etiquetas-de-turno';

describe('etiquetas de recepcion', () => {
  it('ningun estado dice que el paciente fue atendido', () => {
    for (const estado of ['LLEGO', 'VALIDADA', 'OBSERVADA', 'EN_ESPERA', 'LLAMADA']) {
      expect(textoDeRecepcion(estado)).not.toMatch(/atendido|atendiendo/);
    }
    // Un estado que este cliente no conoce se muestra crudo, nunca en blanco.
    expect(textoDeRecepcion('SE_RETIRO')).toBe('SE_RETIRO');
    expect(textoDeRecepcion(undefined)).toBe('Estado desconocido');
  });

  it('la modalidad solo se rotula cuando se resolvio', () => {
    expect(textoDeModalidad('PARTICULAR')).toBe('Particular');
    expect(textoDeModalidad(undefined)).toBe('');
  });

  it('anulada y cerrada no son recepciones abiertas', () => {
    expect(recepcionAbierta({ estado: RecepcionEstadoEnum.LLAMADA })).toBe(true);
    expect(recepcionAbierta({ estado: RecepcionEstadoEnum.ANULADA })).toBe(false);
    expect(recepcionAbierta({ estado: RecepcionEstadoEnum.CERRADA })).toBe(false);
    expect(recepcionAbierta(undefined)).toBe(false);
  });

  it('EN_ESPERA del turno solo sobrevive como historia', () => {
    // DP-16: el servidor ya no lo emite, pero los eventos viejos del turno pueden traerlo.
    expect(textoDeEstado('EN_ESPERA')).toContain('historico');
  });
});
