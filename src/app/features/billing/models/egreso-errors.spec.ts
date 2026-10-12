import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { CausaEgreso, traducirErrorEgreso } from './egreso-errors';

function problema(tipo: string, status: number, extra: object = {}): AkineHttpError {
  return new AkineHttpError(
    status,
    {
      type: `https://akine.app/problems/${tipo}`,
      status,
      detail: 'detalle del servidor',
      ...extra,
    },
    false,
  );
}

describe('traducirErrorEgreso', () => {
  it.each<[string, number, CausaEgreso, boolean]>([
    ['egreso-no-editable', 409, 'no-editable', true],
    ['egreso-no-confirmable', 409, 'no-confirmable', true],
    ['egreso-sin-comprobante', 400, 'sin-comprobante', false],
    ['egreso-ya-anulado', 409, 'ya-anulado', true],
    ['egreso-con-pagos', 409, 'con-pagos', true],
    ['egreso-no-pagable', 409, 'no-pagable', true],
    ['egreso-saldo-insuficiente', 409, 'saldo-insuficiente', true],
    ['egreso-comprobante-duplicado', 409, 'comprobante-duplicado', false],
    ['pago-egreso-ya-anulado', 409, 'pago-ya-anulado', true],
    ['beneficiario-no-vinculado', 409, 'beneficiario-no-vinculado', false],
    ['caja-no-abierta', 409, 'caja', false],
    ['caja-saldo-insuficiente', 409, 'caja', false],
    ['caja-moneda-distinta', 409, 'caja', false],
    ['movimiento-no-reversible', 409, 'pago-ya-anulado', true],
    ['idempotency-key-conflict', 409, 'clave-reusada', false],
  ])('%s se traduce a un mensaje propio', (tipo, status, causa, recargar) => {
    const traducido = traducirErrorEgreso(problema(tipo, status));
    expect(traducido.causa).toBe(causa);
    expect(traducido.recargar).toBe(recargar);
    expect(traducido.mensaje).not.toBe('detalle del servidor');
  });

  it('usa el saldo que manda el backend para que el mensaje sea accionable', () => {
    expect(
      traducirErrorEgreso(problema('egreso-saldo-insuficiente', 409, { saldoDisponible: 1500 }))
        .mensaje,
    ).toContain('1.500,00');
    expect(
      traducirErrorEgreso(problema('egreso-con-pagos', 409, { yaPagado: 200.5 })).mensaje,
    ).toContain('200,50');
    const caja = traducirErrorEgreso(
      problema('caja-saldo-insuficiente', 409, { saldoDisponible: 80 }),
    );
    expect(caja.mensaje).toContain('80,00');
    expect(caja.irACaja).toBe(true);
  });

  it('el conflicto de clave pide renovarla', () => {
    expect(traducirErrorEgreso(problema('idempotency-key-conflict', 409)).renovarClave).toBe(true);
  });

  it('distingue red, falta de contexto, 403, 404, 400, 409 y lo desconocido', () => {
    expect(traducirErrorEgreso(new AkineHttpError(0, null, true)).causa).toBe('red');
    expect(traducirErrorEgreso(problema('missing-tenant-context', 403)).causa).toBe('sin-contexto');
    expect(traducirErrorEgreso(new AkineHttpError(403, null, false)).causa).toBe('sin-permiso');
    expect(traducirErrorEgreso(new AkineHttpError(404, null, false)).causa).toBe('no-encontrado');
    const invalido = traducirErrorEgreso(problema('validation-error', 400));
    expect(invalido.causa).toBe('datos-invalidos');
    expect(invalido.mensaje).toBe('detalle del servidor');
    expect(traducirErrorEgreso(new AkineHttpError(409, null, false)).causa).toBe('conflicto');
    expect(traducirErrorEgreso(new AkineHttpError(500, null, false)).causa).toBe('otro');
    expect(traducirErrorEgreso(new Error('x')).causa).toBe('otro');
  });
});
