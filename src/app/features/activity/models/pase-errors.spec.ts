import { AkineHttpError, ProblemDetail } from '../../../core/interceptors/error.interceptor';

import { errorSinContextoDePase, traducirErrorPase } from './pase-errors';

function error(status: number, tipo: string | null, extras: Record<string, unknown> = {}) {
  return new AkineHttpError(
    status,
    {
      ...(tipo === null ? {} : { type: `https://akine.app/problems/${tipo}` }),
      status,
      detail: 'Detalle del servidor.',
      ...extras,
    } as ProblemDetail,
    false,
  );
}

describe('traducirErrorPase', () => {
  it('los dos tipos propios de M29 tienen su causa', () => {
    expect(traducirErrorPase(error(409, 'producto-no-vendible')).causa).toBe(
      'producto-no-vendible',
    );
    const nombre = traducirErrorPase(error(409, 'producto-nombre-en-uso'));
    expect(nombre.causa).toBe('nombre-en-uso');
    expect(nombre.mensaje).toContain('Elegi otro nombre');
  });

  it('el conflict generico muestra el detalle del servidor (oferta sin pack, baja)', () => {
    const r = traducirErrorPase(error(409, 'conflict'));
    expect(r.causa).toBe('conflicto');
    expect(r.mensaje).toBe('Detalle del servidor.');
  });

  it('version vieja, clave reusada y validacion con campos', () => {
    expect(traducirErrorPase(error(409, 'concurrent-modification')).causa).toBe('version-vieja');
    expect(traducirErrorPase(error(409, 'idempotency-key-conflict')).causa).toBe('clave-reusada');
    const v = traducirErrorPase(
      error(400, 'validation-error', { errors: { precio: 'mayor a 0' } }),
    );
    expect(v.causa).toBe('validacion');
    expect(v.campos['precio']).toBe('mayor a 0');
  });

  it('403, 404, red, sin contexto y desconocido', () => {
    expect(traducirErrorPase(error(403, null)).causa).toBe('sin-permiso');
    expect(traducirErrorPase(error(404, null)).causa).toBe('no-encontrado');
    expect(traducirErrorPase(new AkineHttpError(0, null, true)).causa).toBe('red');
    expect(traducirErrorPase(new Error('x')).causa).toBe('otro');
    expect(traducirErrorPase(error(500, null)).mensaje).toBe('Detalle del servidor.');
    expect(errorSinContextoDePase().causa).toBe('sin-contexto');
  });
});
