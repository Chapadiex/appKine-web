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

  /**
   * URI completa y no el slug interpolado: asi `check-problem-types.mjs` ve que cada tipo del
   * contrato que emite `BillingProblemHandler` para M21 tiene su fila, y un renombre del backend
   * rompe el gate en vez de dejar el mapeo apuntando a nada.
   */
  it.each([
    ['https://akine.app/problems/presentacion-no-editable', 'no-editable', true],
    ['https://akine.app/problems/presentacion-estado-invalido', 'estado-invalido', true],
    ['https://akine.app/problems/presentacion-vacia', 'vacia', false],
    ['https://akine.app/problems/obligacion-ya-presentada', 'ya-presentada', true],
    ['https://akine.app/problems/obligacion-no-presentable', 'no-presentable', true],
    ['https://akine.app/problems/presentacion-saldo-insuficiente', 'saldo-insuficiente', true],
    ['https://akine.app/problems/item-no-debitable', 'item-no-debitable', true],
    ['https://akine.app/problems/factura-duplicada', 'factura-duplicada', false],
  ] as const)('%s -> %s', (type, causa, recargar) => {
    const traducido = traducirErrorPresentacion(
      new AkineHttpError(409, { type, status: 409 }, false),
    );
    expect(traducido.causa).toBe(causa);
    expect(traducido.recargar).toBe(recargar);
    expect(traducido.mensaje).not.toBe('');
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
