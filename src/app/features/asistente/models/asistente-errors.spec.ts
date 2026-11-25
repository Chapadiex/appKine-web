import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { traducirErrorAsistente } from './asistente-errors';

function problema(tipo: string, detail?: string): AkineHttpError {
  return new AkineHttpError(409, { type: `https://akine.app/problems/${tipo}`, detail }, false);
}

describe('traducirErrorAsistente', () => {
  it('unErrorQueNoEsHttpEsGenerico', () => {
    expect(traducirErrorAsistente(new Error('x')).causa).toBe('otro');
  });

  it('unErrorDeRedPideRevisarLaConexion', () => {
    expect(traducirErrorAsistente(new AkineHttpError(0, null, true)).causa).toBe('red');
  });

  it.each([
    ['asistente-deshabilitado', 'deshabilitado'],
    ['asistente-no-disponible', 'no-disponible'],
    ['accion-no-vigente', 'no-vigente'],
    ['not-found', 'no-vigente'],
    ['acciones-deshabilitadas', 'deshabilitado'],
    ['forbidden', 'sin-permiso'],
    ['conflict', 'otro'],
  ])('%s se traduce a %s', (tipo, causa) => {
    expect(traducirErrorAsistente(problema(tipo)).causa).toBe(causa);
  });

  it('validacionUsaElDetalleDelServidorOElTextoPorDefecto', () => {
    expect(
      traducirErrorAsistente(problema('validation-error', 'La pregunta es obligatoria')).mensaje,
    ).toBe('La pregunta es obligatoria');
    expect(traducirErrorAsistente(problema('validation-error')).mensaje).toContain('no es válida');
  });
});
