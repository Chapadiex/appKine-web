import { AkineHttpError, ProblemDetail } from '../../../core/interceptors/error.interceptor';

import { errorSinContextoDeActividad, traducirErrorActividad } from './actividad-errors';

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

/**
 * Spec del traductor de errores de clases e inscripciones. Lo que decide comportamiento es que
 * cada tipo llegue a su ACCION: `clase-completa` ofrece la espera, las transiciones mandan a
 * releer, los de programacion a corregir el formulario.
 */
describe('traducirErrorActividad', () => {
  it('clase-completa ofrece la lista de espera y nombra la ocupacion', () => {
    const r = traducirErrorActividad(
      error(409, 'clase-completa', { capacidadEfectiva: 2, ocupados: 2 }),
    );
    expect(r.causa).toBe('clase-completa');
    expect(r.accion).toBe('ofrecer-espera');
    expect(r.mensaje).toContain('Ocupados 2 de 2');
  });

  it('clase-con-honorarios-liquidados (DP-38) explica que hay que anular el egreso', () => {
    const r = traducirErrorActividad(error(409, 'clase-con-honorarios-liquidados', { claseId: 9 }));
    expect(r.causa).toBe('clase-con-honorarios-liquidados');
    expect(r.accion).toBe('ninguna');
    expect(r.mensaje).toContain('anula el egreso de esa liquidacion');
  });

  it('clase-completa sin extensiones conserva el mensaje base', () => {
    const r = traducirErrorActividad(error(409, 'clase-completa'));
    expect(r.mensaje).toContain('lista de espera');
    expect(r.mensaje).not.toContain('Ocupados');
  });

  it('las dos transiciones mandan a releer y traen el motivo', () => {
    const clase = traducirErrorActividad(
      error(409, 'clase-transicion-no-permitida', { motivo: 'ya empezo' }),
    );
    expect(clase.accion).toBe('recargar');
    expect(clase.motivo).toBe('ya empezo');
    const inscripcion = traducirErrorActividad(
      error(409, 'inscripcion-transicion-no-permitida', { motivo: 'en espera' }),
    );
    expect(inscripcion.causa).toBe('inscripcion-transicion-no-permitida');
    expect(inscripcion.accion).toBe('recargar');
  });

  it('los rechazos de programacion mandan a corregir', () => {
    expect(traducirErrorActividad(error(409, 'clase-no-programable')).accion).toBe('corregir');
    const capacidad = traducirErrorActividad(
      error(409, 'clase-capacidad-no-admitida', { capacidadPedida: 30, capacidadMaxima: 12 }),
    );
    expect(capacidad.accion).toBe('corregir');
    expect(capacidad.mensaje).toContain('Pediste 30 lugares y el limite es 12');
    expect(traducirErrorActividad(error(409, 'clase-capacidad-no-admitida')).mensaje).toContain(
      'Revisa la capacidad',
    );
    expect(traducirErrorActividad(error(409, 'slot-no-disponible')).causa).toBe(
      'horario-no-disponible',
    );
  });

  it('recurso-ocupado dice cual de los dos recursos', () => {
    expect(
      traducirErrorActividad(error(409, 'recurso-ocupado', { recurso: 'profesional' })).mensaje,
    ).toContain('El profesional');
    expect(
      traducirErrorActividad(error(409, 'recurso-ocupado', { recurso: 'espacio' })).mensaje,
    ).toContain('El box');
    expect(traducirErrorActividad(error(409, 'recurso-ocupado')).mensaje).toContain('otra clase');
  });

  it('conflict con inscripcionExistenteId es la persona ya anotada', () => {
    expect(
      traducirErrorActividad(error(409, 'conflict', { inscripcionExistenteId: 9 })).causa,
    ).toBe('ya-inscripta');
    expect(traducirErrorActividad(error(409, 'conflict')).causa).toBe('conflicto');
  });

  it('version vieja, clave reusada, suscripcion y validacion', () => {
    expect(traducirErrorActividad(error(409, 'concurrent-modification')).causa).toBe(
      'version-vieja',
    );
    expect(traducirErrorActividad(error(409, 'idempotency-key-conflict')).accion).toBe(
      'reintentar-con-clave-nueva',
    );
    expect(traducirErrorActividad(error(403, 'subscription-suspended')).causa).toBe(
      'suscripcion-suspendida',
    );
    const validacion = traducirErrorActividad(
      error(400, 'validation-error', { errors: { capacidad: 'debe ser mayor que 0' } }),
    );
    expect(validacion.campos['capacidad']).toBe('debe ser mayor que 0');
  });

  it('cae por status cuando el tipo no es propio', () => {
    expect(traducirErrorActividad(error(403, 'forbidden')).causa).toBe('sin-permiso');
    expect(traducirErrorActividad(error(404, 'not-found')).causa).toBe('no-encontrado');
    expect(traducirErrorActividad(error(409, null)).causa).toBe('conflicto');
    expect(traducirErrorActividad(error(429, 'rate-limited')).causa).toBe('limite');
    expect(traducirErrorActividad(error(500, null)).mensaje).toBe('Detalle del servidor.');
  });

  it('sin contexto, de red o desconocido', () => {
    expect(traducirErrorActividad(error(403, 'missing-tenant-context')).accion).toBe(
      'elegir-contexto',
    );
    expect(errorSinContextoDeActividad().causa).toBe('sin-contexto');
    expect(traducirErrorActividad(new AkineHttpError(0, null, true)).causa).toBe('red');
    expect(traducirErrorActividad(new Error('x')).causa).toBe('otro');
  });
});
