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

  it('los tipos de 08.07/08.08: abono superpuesto, no ajustable con motivo y con cobros', () => {
    expect(traducirErrorPase(error(409, 'abono-periodo-superpuesto')).causa).toBe(
      'abono-superpuesto',
    );
    const conMotivo = traducirErrorPase(
      error(409, 'pase-no-ajustable', { motivo: 'esta vencido' }),
    );
    expect(conMotivo.causa).toBe('pase-no-ajustable');
    expect(conMotivo.mensaje).toBe('No se puede: el pase esta vencido. No se cambio nada.');
    expect(traducirErrorPase(error(409, 'pase-no-ajustable')).mensaje).toContain(
      'no admite esa operacion',
    );
    for (const [causa, frase] of [
      ['ESTADO', 'esta anulado o vencido'],
      ['FUERA_DE_VIGENCIA', 'la vigencia del pase ya termino'],
      ['FUERA_DE_RANGO', 'por debajo de 0 o por encima de los creditos comprados'],
      ['CREDITOS_USADOS', 'ya tiene creditos usados'],
    ]) {
      // La causa manda; el texto de `motivo` no se lee.
      const porCausa = traducirErrorPase(
        error(409, 'pase-no-ajustable', { causa, motivo: 'texto libre del servidor' }),
      );
      expect(porCausa.mensaje).toContain(frase);
      expect(porCausa.mensaje).not.toContain('texto libre');
    }
    // Una causa que este cliente no conoce cae al motivo, tal como llega.
    expect(
      traducirErrorPase(error(409, 'pase-no-ajustable', { causa: 'OTRA', motivo: 'esta raro' }))
        .mensaje,
    ).toBe('No se puede: el pase esta raro. No se cambio nada.');
    expect(
      traducirErrorPase(error(409, 'pase-no-ajustable', { causa: 'toString' })).mensaje,
    ).toContain('no admite esa operacion');
    const conMoneda = traducirErrorPase(
      error(409, 'pase-con-cobros', { cobrado: 1500.5, moneda: 'USD' }),
    );
    expect(conMoneda.mensaje.replace(/\s+/g, ' ')).toContain('(US$ 1.500,50 cobrados)');
    const cobros = traducirErrorPase(error(409, 'pase-con-cobros', { cobrado: 1500.5 }));
    expect(cobros.causa).toBe('pase-con-cobros');
    expect(cobros.cobrado).toBe(1500.5);
    expect(cobros.mensaje).toContain('(1.500,50 cobrados)');
    expect(traducirErrorPase(error(409, 'pase-con-cobros')).mensaje).toContain(
      'ya tiene cobros. Primero',
    );
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
