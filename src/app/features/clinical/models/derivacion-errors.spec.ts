import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { textoDeBloqueo, traducirErrorDeDerivacion } from './derivacion-errors';

/**
 * Spec de lo propio de derivar (AKINE-08.04) sobre el traductor del panel grupal: los textos que
 * alli hablan de otra operacion se reemplazan, y los tipos del 409 se mantienen.
 */
describe('traducirErrorDeDerivacion', () => {
  it.each([
    ['oferta-no-clinica', 409, 'oferta-no-clinica'],
    ['participacion-sin-asistencia', 409, 'sin-asistencia'],
    ['caso-no-activo', 409, 'caso-no-activo'],
    ['autorizacion-no-elegible', 409, 'autorizacion-no-elegible'],
    ['derivacion-no-accesible', 404, 'no-encontrado'],
    ['justificacion-de-acceso-requerida', 403, 'requiere-justificacion'],
  ])('mantiene la causa de %s', (tipo, status, causa) => {
    expect(traducirErrorDeDerivacion(problema(tipo, status)).causa).toBe(causa);
  });

  it('un 403 sin tipo propio habla de derivar, no de atender', () => {
    const error = traducirErrorDeDerivacion(new AkineHttpError(403, null, false));
    expect(error.causa).toBe('sin-permiso');
    expect(error.mensaje).toContain('hc:write');
  });

  it('un 400 no es la reversion sin motivo', () => {
    const error = traducirErrorDeDerivacion(problema('validation-error', 400));
    expect(error.causa).toBe('otro');
    expect(error.mensaje).not.toContain('Revertir');
  });

  it('sin perfil de paciente dice donde se activa', () => {
    const error = traducirErrorDeDerivacion(problema('persona-sin-perfil-paciente', 409));
    expect(error.causa).toBe('sin-perfil-paciente');
    expect(error.mensaje).toContain('padron');
  });
});

describe('textoDeBloqueo', () => {
  it('traduce los bloqueos conocidos y deja a la vista uno nuevo', () => {
    expect(textoDeBloqueo('OFERTA_NO_CLINICA')).toContain('no genera registro clinico');
    expect(textoDeBloqueo('SIN_ASISTENCIA')).toContain('asistencia registrada');
    expect(textoDeBloqueo('AUSENTE')).toContain('ausente');
    expect(textoDeBloqueo('OTRO_CODIGO')).toBe('OTRO_CODIGO');
  });
});

function problema(tipo: string, status: number): AkineHttpError {
  return new AkineHttpError(
    status,
    { type: `https://akine.app/problems/${tipo}`, status, detail: 'texto del servidor' },
    false,
  );
}
