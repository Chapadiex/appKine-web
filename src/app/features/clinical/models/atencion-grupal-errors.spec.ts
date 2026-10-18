import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import {
  errorSinContextoGrupal,
  traducirErrorAtencionGrupal,
  traducirFalloDeAtencion,
} from './atencion-grupal-errors';

/**
 * Spec del traductor de errores de la atencion clinica grupal (AKINE-08.05).
 *
 * <p>Verifica la <b>causa</b>, que es lo que la pantalla ramifica, y que los cuatro tipos propios
 * de la etapa tengan cada uno un texto distinto: un mensaje generico para `derivacion-con-sesion`
 * dejaria al usuario sin saber que la atencion es lo que fija la derivacion.
 */
describe('traducirErrorAtencionGrupal', () => {
  it.each([
    ['participacion-sin-derivacion', 409, 'sin-derivacion'],
    ['derivacion-ambigua', 409, 'derivacion-ambigua'],
    ['derivacion-con-sesion', 409, 'derivacion-con-sesion'],
    ['caso-de-atencion-grupal', 409, 'caso-de-atencion-grupal'],
    ['participacion-sin-asistencia', 409, 'sin-asistencia'],
    ['oferta-no-clinica', 409, 'oferta-no-clinica'],
    ['caso-clinico-cerrado', 409, 'caso-cerrado'],
    ['persona-sin-perfil-paciente', 409, 'sin-perfil-paciente'],
    ['caso-no-activo', 409, 'caso-no-activo'],
    ['autorizacion-no-elegible', 409, 'autorizacion-no-elegible'],
    ['justificacion-de-acceso-requerida', 403, 'requiere-justificacion'],
    ['derivacion-no-accesible', 404, 'no-encontrado'],
    ['validation-error', 400, 'motivo-obligatorio'],
  ])('mapea %s por problemType, no por el detail', (tipo, status, causa) => {
    expect(traducirErrorAtencionGrupal(problema(tipo, status)).causa).toBe(causa);
  });

  it('los cuatro tipos de la etapa tienen textos propios y distintos', () => {
    const textos = [
      'participacion-sin-derivacion',
      'derivacion-ambigua',
      'derivacion-con-sesion',
      'caso-de-atencion-grupal',
    ].map((tipo) => traducirErrorAtencionGrupal(problema(tipo, 409)).mensaje);
    expect(new Set(textos).size).toBe(4);
    expect(textos.some((texto) => texto.includes('texto que no dice nada'))).toBe(false);
  });

  it('derivacion-ambigua trae los ids entre los que elegir, sin lo que no es entero', () => {
    const cuerpo = {
      type: 'https://akine.app/problems/derivacion-ambigua',
      status: 409,
      derivacionIds: [11, 12, 'x', 1.5],
    };
    const error = new AkineHttpError(409, cuerpo, false);
    expect(traducirErrorAtencionGrupal(error).derivacionIds).toEqual([11, 12]);
  });

  it('un 403 sin tipo propio es falta de permiso; un 404, que no existe', () => {
    expect(traducirErrorAtencionGrupal(sinCuerpo(403)).causa).toBe('sin-permiso');
    expect(traducirErrorAtencionGrupal(sinCuerpo(404)).causa).toBe('no-encontrado');
  });

  it('sin red, sin contexto o con algo que no es HTTP', () => {
    expect(traducirErrorAtencionGrupal(new AkineHttpError(0, null, true)).causa).toBe('red');
    expect(traducirErrorAtencionGrupal(problema('missing-tenant-context', 403)).causa).toBe(
      'sin-contexto',
    );
    expect(traducirErrorAtencionGrupal(new Error('x')).causa).toBe('otro');
    expect(errorSinContextoGrupal().causa).toBe('sin-contexto');
  });

  it('otro 409 muestra el detail del servidor', () => {
    const error = new AkineHttpError(
      409,
      { type: 'https://akine.app/problems/conflict', status: 409, detail: 'Algo concreto' },
      false,
    );
    expect(traducirErrorAtencionGrupal(error)).toEqual({ mensaje: 'Algo concreto', causa: 'otro' });
  });
});

describe('traducirFalloDeAtencion', () => {
  it('traduce el problemType del item por su ultimo segmento', () => {
    expect(
      traducirFalloDeAtencion('https://akine.app/problems/participacion-sin-derivacion', 'x').causa,
    ).toBe('sin-derivacion');
  });

  it('un tipo no previsto muestra el detalle; sin detalle, el generico', () => {
    expect(traducirFalloDeAtencion('https://akine.app/problems/conflict', 'Detalle')).toEqual({
      mensaje: 'Detalle',
      causa: 'otro',
    });
    expect(traducirFalloDeAtencion(undefined, undefined).causa).toBe('otro');
  });
});

function problema(tipo: string, status: number): AkineHttpError {
  return new AkineHttpError(
    status,
    { type: `https://akine.app/problems/${tipo}`, status, detail: 'texto que no dice nada' },
    false,
  );
}

function sinCuerpo(status: number): AkineHttpError {
  return new AkineHttpError(status, null, false);
}
