import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { errorSinContexto, traducirErrorPresentacion } from './presentacion-errors';

function problema(tipo: string, status: number, detail?: string): AkineHttpError {
  return new AkineHttpError(
    status,
    { type: `https://akine.app/problems/${tipo}`, status, detail },
    false,
  );
}

describe('traducirErrorPresentacion', () => {
  it('usa el detalle real del backend en los conflictos conocidos', () => {
    const traducido = traducirErrorPresentacion(
      problema('presentacion-no-concilia', 409, 'Quedan $ 1.500,00 sin explicar.'),
    );
    expect(traducido.causa).toBe('no-concilia');
    expect(traducido.mensaje).toBe('Quedan $ 1.500,00 sin explicar.');
    expect(traducido.recargar).toBe(false);
  });

  it('sin detalle cae en el texto propio, y marca recargar cuando la pantalla quedo vieja', () => {
    const traducido = traducirErrorPresentacion(problema('presentacion-no-editable', 409));
    expect(traducido.causa).toBe('no-editable');
    expect(traducido.mensaje).toContain('ya no es un borrador');
    expect(traducido.recargar).toBe(true);
  });

  it('distingue red, falta de contexto, 403, 404 y lo desconocido', () => {
    expect(traducirErrorPresentacion(new AkineHttpError(0, null, true)).causa).toBe('red');
    expect(traducirErrorPresentacion(problema('missing-tenant-context', 403)).causa).toBe(
      'sin-contexto',
    );
    expect(traducirErrorPresentacion(new AkineHttpError(403, null, false)).causa).toBe(
      'sin-permiso',
    );
    expect(traducirErrorPresentacion(new AkineHttpError(404, null, false)).causa).toBe(
      'no-encontrado',
    );
    expect(traducirErrorPresentacion(new AkineHttpError(400, null, false)).causa).toBe(
      'datos-invalidos',
    );
    expect(traducirErrorPresentacion(new AkineHttpError(409, null, false)).causa).toBe('conflicto');
    expect(traducirErrorPresentacion(new AkineHttpError(500, null, false)).causa).toBe('otro');
    expect(traducirErrorPresentacion(new Error('x')).causa).toBe('otro');
    expect(errorSinContexto().causa).toBe('sin-contexto');
  });
});
