import {
  RecepcionEstadoEnum,
  RecepcionModalidadEnum,
} from '../../../api/generated/model/recepcion';
import {
  admiteParticular,
  admiteRetiro,
  llegadaVigente,
  nombreDeEstadoDeRecepcion,
  recepcionAbierta,
  recepcionRetirada,
  textoDeEventoDeRecepcion,
  textoDeModalidad,
  textoDeRecepcion,
} from './etiquetas-de-recepcion';
import { textoDeEstado } from './etiquetas-de-turno';

describe('etiquetas de recepción', () => {
  it('ningún estado dice que el paciente fue atendido', () => {
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

  it('RETIRADO (U-21): terminal, pero la llegada vale', () => {
    const retirada = { estado: RecepcionEstadoEnum.RETIRADO };
    expect(recepcionAbierta(retirada)).toBe(false);
    expect(recepcionRetirada(retirada)).toBe(true);
    expect(textoDeRecepcion('RETIRADO')).toContain('la llegada consta');
    expect(textoDeEventoDeRecepcion('RETIRO')).toBe('Se retiro sin ser atendido');
    expect(textoDeEventoDeRecepcion('NUEVO')).toBe('NUEVO');
    expect(textoDeEventoDeRecepcion(undefined)).toBe('Evento desconocido');
    // La llegada consta: ni otro check-in ni el prepago 'antes de la llegada'.
    expect(llegadaVigente(retirada)).toBe(true);
    expect(llegadaVigente({ estado: RecepcionEstadoEnum.ANULADA })).toBe(false);
    expect(llegadaVigente({ estado: RecepcionEstadoEnum.EN_ESPERA })).toBe(true);
    expect(llegadaVigente(undefined)).toBe(false);
    expect(nombreDeEstadoDeRecepcion('RETIRADO')).toBe('Se retiro sin ser atendido');
    expect(nombreDeEstadoDeRecepcion('EN_ESPERA')).not.toContain(' — ');
    expect(nombreDeEstadoDeRecepcion('NUEVO')).toBe('NUEVO');
  });

  it('Particular desde la espera salvo que ya lo sea; retiro solo desde LLEGO o EN_ESPERA', () => {
    expect(admiteParticular({ estado: RecepcionEstadoEnum.LLEGO })).toBe(true);
    expect(admiteParticular({ estado: RecepcionEstadoEnum.OBSERVADA })).toBe(true);
    expect(
      admiteParticular({
        estado: RecepcionEstadoEnum.EN_ESPERA,
        modalidad: RecepcionModalidadEnum.COBERTURA,
      }),
    ).toBe(true);
    expect(
      admiteParticular({
        estado: RecepcionEstadoEnum.EN_ESPERA,
        modalidad: RecepcionModalidadEnum.PARTICULAR,
      }),
    ).toBe(false);
    expect(admiteParticular({ estado: RecepcionEstadoEnum.VALIDADA })).toBe(false);
    expect(admiteParticular(undefined)).toBe(false);
    expect(admiteRetiro({ estado: RecepcionEstadoEnum.LLEGO })).toBe(true);
    expect(admiteRetiro({ estado: RecepcionEstadoEnum.EN_ESPERA })).toBe(true);
    expect(admiteRetiro({ estado: RecepcionEstadoEnum.LLAMADA })).toBe(false);
    expect(admiteRetiro({ estado: RecepcionEstadoEnum.VALIDADA })).toBe(false);
  });
});
