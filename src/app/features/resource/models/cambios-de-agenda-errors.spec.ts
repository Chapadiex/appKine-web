import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { traducirErrorCambiosDeAgenda } from './cambios-de-agenda-errors';

function problema(status: number, tipo: string, extras: Record<string, unknown> = {}) {
  return new AkineHttpError(
    status,
    { type: `https://akine.app/problems/${tipo}`, status, ...extras },
    false,
  );
}

describe('traducirErrorCambiosDeAgenda', () => {
  it('el 403 con alcance PROPIO no se confunde con la falta de permiso', () => {
    const propio = traducirErrorCambiosDeAgenda(problema(403, 'forbidden', { alcance: 'PROPIO' }));
    expect(propio.causa).toBe('solo-propio');
    expect(propio.mensaje).toBe('Solo podés ver los cambios de tu propia agenda.');

    expect(traducirErrorCambiosDeAgenda(problema(403, 'forbidden')).causa).toBe('sin-permiso');
    expect(traducirErrorCambiosDeAgenda(problema(403, 'missing-tenant-context')).causa).toBe(
      'sin-contexto',
    );
    expect(traducirErrorCambiosDeAgenda(problema(404, 'not-found')).causa).toBe('no-encontrado');
    expect(traducirErrorCambiosDeAgenda(new Error('x')).causa).toBe('otro');
  });
});
