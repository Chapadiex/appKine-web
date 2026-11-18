import { AkineHttpError } from '../../core/interceptors/error.interceptor';
import { traducirErrorDictado } from './dictado-errors';

function problema(status: number, tipo: string, detail?: string): AkineHttpError {
  return new AkineHttpError(status, { type: `https://akine.app/problems/${tipo}`, detail }, false);
}

describe('traducirErrorDictado', () => {
  it('distingue el micrófono negado del que no existe', () => {
    expect(traducirErrorDictado(new DOMException('no', 'NotAllowedError')).mensaje).toContain(
      'no dio permiso',
    );
    const sinMicrofono = traducirErrorDictado(new DOMException('no', 'NotFoundError'));
    expect(sinMicrofono.causa).toBe('microfono');
    expect(sinMicrofono.mensaje).toContain('No se encontró un micrófono');
  });

  it('un error que no es HTTP es genérico', () => {
    expect(traducirErrorDictado(new Error('x')).causa).toBe('otro');
  });

  it('un error de red pide revisar la conexión', () => {
    expect(traducirErrorDictado(new AkineHttpError(0, null, true)).causa).toBe('red');
  });

  it('decide por el problemType, no por el texto del backend', () => {
    expect(traducirErrorDictado(problema(409, 'dictado-deshabilitado')).causa).toBe(
      'deshabilitado',
    );
    expect(traducirErrorDictado(problema(503, 'dictado-no-disponible')).causa).toBe(
      'no-disponible',
    );
    expect(traducirErrorDictado(problema(403, 'forbidden')).causa).toBe('sin-permiso');
    expect(traducirErrorDictado(problema(500, 'internal-error')).causa).toBe('otro');
  });

  it('un 400 muestra lo que redactó el backend, o un pedido de volver a grabar', () => {
    expect(
      traducirErrorDictado(problema(400, 'validation-error', 'No se pudo leer la grabacion.'))
        .mensaje,
    ).toBe('No se pudo leer la grabacion.');
    expect(traducirErrorDictado(problema(400, 'validation-error')).mensaje).toContain(
      'Volvé a grabar',
    );
  });
});
