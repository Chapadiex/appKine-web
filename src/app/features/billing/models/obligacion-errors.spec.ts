import { ProblemType } from '../../../api/generated/model/problem-type';
import { AkineHttpError, ProblemDetail } from '../../../core/interceptors/error.interceptor';

import { CausaObligacion, hayQueRecargar, traducirErrorObligacion } from './obligacion-errors';

/**
 * Los `problemType` propios de la obligacion, escritos a mano y a proposito.
 *
 * <p>Misma razon que en `cobro-errors.spec.ts`: esta lista es el contrato entre la cuenta
 * corriente y el backend. Si el backend renombra `obligacion-con-cobros`, el `switch` cae en su
 * rama generica, el operador ve "conflicto" en vez de "esta deuda ya tiene cobros imputados" y
 * <b>nadie se entera</b>: no hay excepcion ni log, la pantalla sigue verde.
 */
const PROBLEMAS_DE_LA_OBLIGACION = [
  'obligacion-con-cobros',
  'obligacion-already-anulada',
  'concurrent-modification',
] as const;

function cuerpo(datos: Record<string, unknown>): ProblemDetail {
  return datos as ProblemDetail;
}

/**
 * Spec del traductor de errores de la obligacion (M18, AKINE-07.01).
 *
 * <p>Existe porque el archivo no tenia ninguno: sus ramas solo se tocaban de refilon desde la
 * spec de la pantalla de cuenta corriente, que ejercita dos o tres caminos felices y deja sin
 * probar justamente los rechazos que importan.
 *
 * <p>Lo que se cubre es la anulacion de una deuda, que es la operacion peligrosa del modulo:
 * cada rechazo lleva a una accion distinta del operador y confundirlos deja plata sin explicar.
 */
describe('traducirErrorObligacion', () => {
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

  /** Un error sin cuerpo: el backend corto antes de redactar un ProblemDetail. */
  function sinCuerpo(status: number) {
    return new AkineHttpError(status, null, false);
  }

  // -------------------------------------------------------------------------------------
  // 1. Los nombres
  // -------------------------------------------------------------------------------------

  it('los problemType de la obligacion existen en el contrato publicado', () => {
    const publicados = new Set(Object.values(ProblemType).map((uri) => uri.split('/').pop()));

    for (const tipo of PROBLEMAS_DE_LA_OBLIGACION) {
      expect(publicados.has(tipo)).toBe(true);
    }
  });

  it('cada problemType de la obligacion llega a su propia causa', () => {
    const causas = PROBLEMAS_DE_LA_OBLIGACION.map(
      (tipo) => traducirErrorObligacion(problema(tipo, 409)).causa,
    );

    expect(causas).toEqual([
      'con-cobros',
      'ya-anulada',
      'version-vieja',
    ] satisfies CausaObligacion[]);
    expect(new Set(causas).size).toBe(PROBLEMAS_DE_LA_OBLIGACION.length);
  });

  // -------------------------------------------------------------------------------------
  // 2. Lo que no llego a ser una respuesta del backend
  // -------------------------------------------------------------------------------------

  it('lo que no es un AkineHttpError cae en la generica sin inventar un diagnostico', () => {
    const traducido = traducirErrorObligacion(new Error('cualquier cosa'));

    expect(traducido.causa).toBe('otro');
    expect(traducido.yaCobrado).toBeNull();
    expect(traducido.mensaje.length).toBeGreaterThan(0);
  });

  it('un error de red avisa que la cuenta corriente que se ve puede estar desactualizada', () => {
    const traducido = traducirErrorObligacion(new AkineHttpError(0, null, true));

    expect(traducido.causa).toBe('red');
    // El saldo en pantalla es de antes del corte: decir solo "error" invita a operar sobre el.
    expect(traducido.mensaje).toContain('puede no estar');
  });

  it('el rate limit se reconoce por el 429 aunque no traiga problemType', () => {
    const traducido = traducirErrorObligacion(sinCuerpo(429));

    expect(traducido.causa).toBe('limite');
  });

  // -------------------------------------------------------------------------------------
  // 3. Los rechazos que cambian lo que el operador tiene que hacer
  // -------------------------------------------------------------------------------------

  it('con-cobros rescata yaCobrado de la extension para que el mensaje diga cuanto', () => {
    const traducido = traducirErrorObligacion(
      problema('obligacion-con-cobros', 409, { yaCobrado: 1500 }),
    );

    expect(traducido.causa).toBe('con-cobros');
    expect(traducido.yaCobrado).toBe(1500);
    // Anular lo ya cobrado deja plata en la caja sin deuda que la justifique.
    expect(traducido.mensaje).toContain('devolucion');
  });

  it('con-cobros sin la extension no inventa un importe: deja yaCobrado en null', () => {
    const traducido = traducirErrorObligacion(problema('obligacion-con-cobros', 409));

    expect(traducido.causa).toBe('con-cobros');
    expect(traducido.yaCobrado).toBeNull();
  });

  it('missing-tenant-context manda a elegir contexto y aclara que la sesion sigue abierta', () => {
    const traducido = traducirErrorObligacion(problema('missing-tenant-context', 400));

    expect(traducido.causa).toBe('sin-contexto');
    expect(traducido.mensaje).toContain('sesion sigue abierta');
  });

  it('subscription-suspended se distingue de un 403 comun', () => {
    const traducido = traducirErrorObligacion(problema('subscription-suspended', 403));

    // Importa: no es falta de permiso del usuario, es la organizacion suspendida. Mandarlo a
    // "pediselo al administrador" lo haria perseguir a alguien que tampoco puede.
    expect(traducido.causa).toBe('suscripcion-suspendida');
  });

  // -------------------------------------------------------------------------------------
  // 4. Los que se resuelven por status porque el backend no publico un tipo propio
  // -------------------------------------------------------------------------------------

  it('un 403 sin tipo propio es falta de permiso', () => {
    expect(traducirErrorObligacion(problema('forbidden', 403)).causa).toBe('sin-permiso');
  });

  it('un 404 no distingue inexistente de ajeno, para no permitir enumerar deudas', () => {
    const traducido = traducirErrorObligacion(problema('not-found', 404));

    expect(traducido.causa).toBe('no-encontrado');
    expect(traducido.mensaje).toContain('no existen');
  });

  it('un 400 se atribuye al motivo faltante y muestra el detalle real del backend', () => {
    const traducido = traducirErrorObligacion(problema('validation-error', 400));

    expect(traducido.causa).toBe('falta-motivo');
    expect(traducido.mensaje).toBe('Rechazado por el servidor.');
  });

  it('un 400 sin cuerpo cae al texto fijo, que explica por que el motivo no es opcional', () => {
    const traducido = traducirErrorObligacion(sinCuerpo(400));

    expect(traducido.causa).toBe('falta-motivo');
    expect(traducido.mensaje).toContain('auditoria');
  });

  it('un 409 que no es ninguno de los conocidos queda como conflicto generico', () => {
    const traducido = traducirErrorObligacion(problema('conflict', 409));

    expect(traducido.causa).toBe('conflicto');
    expect(traducido.mensaje).toBe('Rechazado por el servidor.');
  });

  it('un 409 sin cuerpo cae al texto fijo de conflicto', () => {
    const traducido = traducirErrorObligacion(sinCuerpo(409));

    expect(traducido.causa).toBe('conflicto');
    expect(traducido.mensaje).toContain('Recarga la cuenta corriente');
  });

  it('un status que nadie previo no se disfraza de otra cosa', () => {
    expect(traducirErrorObligacion(problema('internal-error', 500)).causa).toBe('otro');
    expect(traducirErrorObligacion(sinCuerpo(500)).mensaje).toContain('Volve a intentar');
  });
});

/**
 * <p>La pantalla usa esto para decidir si ademas del aviso tiene que volver a pedir la cuenta
 * corriente. Los tres casos que dan `true` comparten que <b>lo que hay en pantalla ya es
 * mentira</b>; el resto no ensucia lo mostrado y recargar seria ruido.
 */
describe('hayQueRecargar', () => {
  it('recarga cuando lo que se ve en pantalla quedo viejo', () => {
    expect(hayQueRecargar('ya-anulada')).toBe(true);
    expect(hayQueRecargar('version-vieja')).toBe(true);
    expect(hayQueRecargar('conflicto')).toBe(true);
  });

  it('no recarga cuando el estado mostrado sigue siendo valido', () => {
    expect(hayQueRecargar('sin-permiso')).toBe(false);
    expect(hayQueRecargar('red')).toBe(false);
    expect(hayQueRecargar(null)).toBe(false);
  });
});
