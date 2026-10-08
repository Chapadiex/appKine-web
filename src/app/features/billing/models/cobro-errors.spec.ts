import { AkineHttpError, ProblemDetail } from '../../../core/interceptors/error.interceptor';
import { ProblemType } from '../../../api/generated/model/problem-type';

import { CausaCobro, noSeRegistro, traducirErrorCobro } from './cobro-errors';

/**
 * Los `problemType` propios del cobro, escritos a mano y a proposito.
 *
 * <p>Esta lista es el <b>contrato entre esta pantalla y el backend</b>, y por eso la primera
 * prueba del archivo la confronta contra el enum generado. Si el backend renombra
 * `saldo-insuficiente`, el `switch` de `traducirErrorCobro` cae en su rama generica, el operador
 * ve "conflicto" en vez de "alguien cobro antes, recarga los saldos" y <b>nadie se entera</b>: no
 * hay excepcion, no hay log, la pantalla sigue verde. Esa es la falla que este archivo existe para
 * evitar.
 */
const PROBLEMAS_DEL_COBRO = [
  'cobro-no-cuadra',
  'saldo-insuficiente',
  'obligacion-no-cobrable',
  'idempotency-key-conflict',
  // El efectivo entra a la caja de la sede: sin jornada abierta, el cobro entero se rechaza.
  'caja-no-abierta',
] as const;

function cuerpo(datos: Record<string, unknown>): ProblemDetail {
  return datos as ProblemDetail;
}

/**
 * Spec del traductor de errores del cobro (M19, AKINE-07.02).
 *
 * <p>Cubre dos cosas y nada mas: que los nombres del contrato sigan siendo los que la pantalla
 * escucha, y que cada rechazo llegue a su propia accion con el dato que esa accion necesita.
 */
describe('traducirErrorCobro', () => {
  function problema(tipo: string, status: number, extras: Record<string, unknown> = {}) {
    return new AkineHttpError(
      status,
      cuerpo({
        type: `https://akine.app/problems/${tipo}`,
        status,
        detail: 'Rechazado por el servidor.',
        ...extras,
      }),
      false,
    );
  }

  // -------------------------------------------------------------------------------------
  // 1. Los nombres
  // -------------------------------------------------------------------------------------

  it('los problemType del cobro existen en el contrato publicado', () => {
    const publicados = new Set(Object.values(ProblemType).map((uri) => uri.split('/').pop()));

    for (const tipo of PROBLEMAS_DEL_COBRO) {
      // Si esto falla despues de un `api:generate`, el backend renombro el tipo y hay que mover
      // la rama del switch. La pantalla no avisa sola: se queda muda.
      expect(publicados.has(tipo)).toBe(true);
    }
  });

  it('cada problemType del cobro llega a su propia causa: ninguno cae en la rama generica', () => {
    const causas = PROBLEMAS_DEL_COBRO.map((tipo) => traducirErrorCobro(problema(tipo, 409)).causa);

    expect(causas).toEqual([
      'no-cuadra',
      'saldo-insuficiente',
      'no-cobrable',
      'clave-reusada',
      'caja-no-abierta',
    ] satisfies CausaCobro[]);
    expect(new Set(causas).size).toBe(PROBLEMAS_DEL_COBRO.length);
  });

  // -------------------------------------------------------------------------------------
  // 2. Cada rechazo con su accion y su dato
  // -------------------------------------------------------------------------------------

  it('saldo-insuficiente se explica como lo que es y manda a recargar, no a reintentar', () => {
    const traducido = traducirErrorCobro(
      problema('saldo-insuficiente', 409, { obligacionId: 9001, importeIntentado: 8500.5 }),
    );

    expect(traducido.accion).toBe('recargar-cuenta');
    expect(traducido.obligacionId).toBe(9001);
    expect(traducido.importeIntentado).toBe(8500.5);
    // El backend lo garantiza con `UPDATE ... WHERE saldo >= :importe`. Decirlo es lo que evita
    // que el administrativo crea que dejo una deuda en negativo.
    expect(traducido.mensaje).toContain('negativo');
    expect(traducido.mensaje).not.toContain('inesperado');
  });

  it('cobro-no-cuadra trae las dos cifras y no culpa al operador', () => {
    const traducido = traducirErrorCobro(
      problema('cobro-no-cuadra', 400, { esperado: 8500, recibido: 850 }),
    );

    expect(traducido.accion).toBe('corregir-importes');
    expect(traducido.esperado).toBe(8500);
    expect(traducido.recibido).toBe(850);
  });

  it('obligacion-no-cobrable dice por que, y no ofrece reintentar lo mismo', () => {
    const traducido = traducirErrorCobro(
      problema('obligacion-no-cobrable', 409, { motivo: 'ya esta pagada' }),
    );

    expect(traducido.motivo).toBe('ya esta pagada');
    expect(traducido.accion).toBe('recargar-cuenta');
  });

  it('caja-no-abierta manda a abrir la caja, no a recargar la cuenta: recargar no la abre', () => {
    const traducido = traducirErrorCobro(problema('caja-no-abierta', 409, { consultorioId: 7 }));

    expect(traducido.accion).toBe('abrir-caja');
    expect(traducido.mensaje).toContain('caja abierta');
    expect(traducido.mensaje).toContain('No se registro nada');
    // El formulario queda cargado: abierta la caja, el mismo cobro entra.
    expect(noSeRegistro(traducido.causa)).toBe(true);
  });

  it('idempotency-key-conflict pide reintentar con clave nueva', () => {
    const traducido = traducirErrorCobro(problema('idempotency-key-conflict', 409));

    expect(traducido.accion).toBe('reintentar-con-clave-nueva');
    expect(traducido.mensaje).toContain('No es un error tuyo');
  });

  it('una extension con el tipo equivocado no se muestra cruda', () => {
    const traducido = traducirErrorCobro(
      problema('obligacion-no-cobrable', 409, { motivo: { texto: 'ya esta pagada' } }),
    );

    expect(traducido.motivo).toBeNull();
  });

  // -------------------------------------------------------------------------------------
  // 3. Lo que no es propio del cobro
  // -------------------------------------------------------------------------------------

  it('falta de contexto manda al selector y NUNCA se lee como sesion caida', () => {
    const traducido = traducirErrorCobro(problema('missing-tenant-context', 403));

    expect(traducido.causa).toBe('sin-contexto');
    expect(traducido.accion).toBe('elegir-contexto');
    expect(traducido.mensaje).toContain('sesion sigue abierta');
  });

  it('los genericos por status no ofrecen una accion de cobro', () => {
    const sinTipo = (status: number) => new AkineHttpError(status, cuerpo({ status }), false);

    expect(traducirErrorCobro(sinTipo(403)).causa).toBe('sin-permiso');
    expect(traducirErrorCobro(sinTipo(404)).causa).toBe('no-encontrado');
    expect(traducirErrorCobro(sinTipo(400)).causa).toBe('datos-invalidos');
    expect(traducirErrorCobro(sinTipo(409)).causa).toBe('conflicto');
    expect(traducirErrorCobro(sinTipo(500)).causa).toBe('otro');
    expect(traducirErrorCobro(sinTipo(403)).accion).toBe('ninguna');
  });

  it('validation-error y subscription-suspended tienen su propia salida', () => {
    expect(traducirErrorCobro(problema('validation-error', 400)).causa).toBe('datos-invalidos');
    expect(traducirErrorCobro(problema('subscription-suspended', 409)).causa).toBe(
      'suscripcion-suspendida',
    );
  });

  it('sin red no se afirma que el cobro no entro: es el unico caso en que no se sabe', () => {
    const sinRed = new AkineHttpError(0, null, true);
    const traducido = traducirErrorCobro(sinRed);

    expect(traducido.causa).toBe('red');
    // La clave de idempotencia existe justamente para que reintentar aca sea seguro.
    expect(traducido.mensaje).toContain('reintentar no cobre dos veces');
    expect(noSeRegistro('red')).toBe(false);
    expect(noSeRegistro('saldo-insuficiente')).toBe(true);
  });

  it('el rate limit y lo que no es un AkineHttpError caen en su propia rama', () => {
    const limitado = new AkineHttpError(429, cuerpo({ status: 429 }), false, 30);

    expect(traducirErrorCobro(limitado).causa).toBe('limite');
    expect(traducirErrorCobro(new Error('cualquier cosa')).causa).toBe('otro');
  });
});
