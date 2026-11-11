import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { CausaBiblioteca, traducirErrorBiblioteca } from './biblioteca-errors';

function problema(tipo: string | null, status: number, extra: object = {}): AkineHttpError {
  return new AkineHttpError(
    status,
    {
      ...(tipo ? { type: `https://akine.app/problems/${tipo}` } : {}),
      status,
      detail: 'detalle del servidor',
      ...extra,
    },
    false,
  );
}

describe('traducirErrorBiblioteca', () => {
  it.each<[string, number, CausaBiblioteca, boolean]>([
    ['biblioteca-deshabilitada', 409, 'deshabilitada', false],
    ['libro-no-encontrado', 404, 'no-encontrado', true],
    ['libro-duplicado', 409, 'duplicado', false],
    ['libro-archivo-no-aceptado', 400, 'archivo-no-aceptado', false],
    ['libro-en-proceso', 409, 'en-proceso', false],
    ['consulta-ocupada', 503, 'ocupada', false],
    ['asistente-no-disponible', 503, 'asistente-no-disponible', false],
    ['concurrent-modification', 409, 'version-vieja', true],
    ['validation-error', 400, 'datos-invalidos', false],
  ])('%s se traduce a su causa', (tipo, status, causa, recargar) => {
    const traducido = traducirErrorBiblioteca(problema(tipo, status));
    expect(traducido.causa).toBe(causa);
    expect(traducido.recargar).toBe(recargar);
  });

  it('un 413 sin problemType es demasiado-grande', () => {
    const traducido = traducirErrorBiblioteca(problema(null, 413));
    expect(traducido.causa).toBe('demasiado-grande');
    expect(traducido.mensaje).toBe('El archivo supera el tamaño máximo permitido.');
  });

  it('un 403 es sin-permiso', () => {
    expect(traducirErrorBiblioteca(problema('forbidden', 403)).causa).toBe('sin-permiso');
  });

  it('libro-duplicado trae el libroId existente', () => {
    expect(traducirErrorBiblioteca(problema('libro-duplicado', 409, { libroId: 7 })).libroId).toBe(
      7,
    );
  });

  it('un error de red es red', () => {
    expect(traducirErrorBiblioteca(new AkineHttpError(0, null, true)).causa).toBe('red');
  });

  it('algo que no es AkineHttpError es otro', () => {
    expect(traducirErrorBiblioteca(new Error('x')).causa).toBe('otro');
  });
});
