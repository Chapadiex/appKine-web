import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { traducirErrorCaja } from './caja-errors';

function problema(tipo: string, status: number, detail?: string): AkineHttpError {
  return new AkineHttpError(
    status,
    { type: `https://akine.app/problems/${tipo}`, status, detail },
    false,
    null,
  );
}

describe('traducirErrorCaja', () => {
  it.each([
    ['missing-tenant-context', 400, 'elegir-contexto'],
    ['subscription-suspended', 403, 'ninguna'],
    ['caja-ya-abierta', 409, 'recargar'],
    ['caja-no-abierta', 409, 'recargar'],
    ['caja-cerrada', 409, 'recargar'],
    ['caja-saldo-cambio', 409, 'recargar'],
    ['caja-saldo-insuficiente', 409, 'corregir'],
    ['caja-moneda-distinta', 409, 'corregir'],
    ['caja-diferencia-sin-motivo', 400, 'corregir'],
    ['movimiento-no-reversible', 409, 'recargar'],
    ['idempotency-key-conflict', 409, 'corregir'],
  ])('%s se resuelve con la accion %s', (tipo, status, accion) => {
    expect(traducirErrorCaja(problema(tipo, status)).accion).toBe(accion);
  });

  it('un conflicto de clave pide renovarla', () => {
    expect(traducirErrorCaja(problema('idempotency-key-conflict', 409)).renovarClave).toBe(true);
  });

  it('sin tipo conocido decide por status y muestra el detail del backend', () => {
    expect(traducirErrorCaja(problema('forbidden', 403)).mensaje).toContain('No tenes permiso');
    expect(traducirErrorCaja(problema('validation-error', 400, 'Importe invalido')).mensaje).toBe(
      'Importe invalido',
    );
    expect(traducirErrorCaja(problema('conflict', 409, 'Otro')).accion).toBe('recargar');
    expect(traducirErrorCaja(problema('internal-error', 500, 'Fallo')).accion).toBe('ninguna');
  });

  it('red, limite y errores que no son HTTP', () => {
    expect(traducirErrorCaja(new AkineHttpError(0, null, true, null)).accion).toBe('recargar');
    expect(traducirErrorCaja(new AkineHttpError(429, null, false, 5)).mensaje).toContain(
      'Demasiados intentos',
    );
    expect(traducirErrorCaja(new Error('x')).accion).toBe('ninguna');
  });
});
