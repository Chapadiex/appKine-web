import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import {
  traducirErrorAsistencia,
  traducirErrorDeLote,
  traducirFalloDeItem,
} from './asistencia-errors';

function http(status: number, type?: string, detail?: string): AkineHttpError {
  const problem = type ? { type: `https://akine.app/problems/${type}`, status, detail } : null;
  return new AkineHttpError(status, problem, status === 0);
}

describe('asistencia-errors', () => {
  it('usa el detail del servidor para la clase que no admite asistencia', () => {
    const error = traducirErrorAsistencia(
      http(409, 'clase-transicion-no-permitida', 'La clase todavia no se inicio'),
    );
    expect(error).toEqual({ mensaje: 'La clase todavia no se inicio', causa: 'clase-no-admite' });
  });

  it('distingue red, falta de contexto, permiso y no encontrado', () => {
    expect(traducirErrorAsistencia(http(0)).causa).toBe('red');
    expect(traducirErrorAsistencia(http(403, 'missing-tenant-context')).causa).toBe('sin-contexto');
    expect(traducirErrorAsistencia(http(403, 'forbidden')).causa).toBe('sin-permiso');
    expect(traducirErrorAsistencia(http(404)).causa).toBe('no-encontrado');
    expect(traducirErrorAsistencia(new Error('x')).causa).toBe('otro');
    expect(traducirErrorAsistencia(http(500, undefined)).causa).toBe('otro');
  });

  it('la correccion sin motivo es un validation-error', () => {
    expect(traducirErrorAsistencia(http(400, 'validation-error')).causa).toBe('motivo-obligatorio');
  });

  it('traduce el problemType de un item del lote por su ultimo segmento', () => {
    expect(
      traducirFalloDeItem(
        'https://akine.app/problems/inscripcion-transicion-no-permitida',
        'La inscripcion esta cancelada',
      ),
    ).toEqual({ mensaje: 'La inscripcion esta cancelada', causa: 'inscripcion-sin-lugar' });
    expect(traducirFalloDeItem('https://akine.app/problems/clase-completa', undefined).causa).toBe(
      'clase-completa',
    );
    expect(traducirFalloDeItem('https://akine.app/problems/conflict', undefined).causa).toBe(
      'duplicada',
    );
    expect(traducirFalloDeItem('https://akine.app/problems/not-found', undefined).causa).toBe(
      'no-encontrado',
    );
    expect(traducirFalloDeItem(undefined, 'raro')).toEqual({ mensaje: 'raro', causa: 'otro' });
  });

  it('un 503 del lote dice cuanto esperar y que no se guardo nada', () => {
    const error = new AkineHttpError(
      503,
      { type: 'https://akine.app/problems/service-unavailable', status: 503 },
      false,
      12,
    );
    const traducido = traducirErrorDeLote(error);
    expect(traducido.causa).toBe('lotes-saturados');
    expect(traducido.mensaje).toContain(
      'Hay muchos registros de asistencia en curso en esta sede. Probá de nuevo en 12 segundos.',
    );
    expect(traducido.mensaje).toContain('No se guardó nada');
  });

  it('un 503 sin Retry-After no inventa un plazo; otros errores siguen igual', () => {
    const sin = traducirErrorDeLote(new AkineHttpError(503, null, false));
    expect(sin.mensaje).toContain('en unos segundos');
    expect(traducirErrorDeLote(http(403)).causa).toBe('sin-permiso');
  });
});
