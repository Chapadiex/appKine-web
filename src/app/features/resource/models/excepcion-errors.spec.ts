import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { CausaExcepcion, traducirErrorExcepcion } from './excepcion-errors';

/** Arma el error tal como lo entrega `errorInterceptor`, con el `type` completo. */
function problema(status: number, tipo: string | null, extras: Record<string, unknown> = {}) {
  return new AkineHttpError(
    status,
    {
      ...(tipo === null ? {} : { type: `https://akine.app/problems/${tipo}` }),
      detail: 'prosa del backend',
      properties: extras,
    },
    false,
  );
}

/**
 * Spec del mapeo de errores de excepciones y de calendario de sede (M05, AKINE-02.04).
 *
 * <p>Mismo formato de tabla que `bloque-errors.spec.ts`, y por el mismo motivo: el fallo que
 * importa es <b>silencioso</b>. Un `type` mal escrito hace que `problemType` devuelva `null`,
 * el `switch` cae al `default` y el usuario recibe "no pudimos completar la operacion" sobre un
 * error que la pantalla sabia explicar.
 */
describe('traducirErrorExcepcion', () => {
  it('cada problem type llega a su causa propia y ninguno cae en la generica', () => {
    const casos: readonly (readonly [number, string, CausaExcepcion])[] = [
      [403, 'missing-tenant-context', 'sin-contexto'],
      [403, 'forbidden', 'sin-permiso'],
      [400, 'validation-error', 'validacion'],
      [404, 'not-found', 'no-encontrado'],
      [409, 'excepcion-already-inactive', 'ya-inactiva'],
      [409, 'consultorio-inactive', 'sede-inactiva'],
      [409, 'profesional-no-vinculado', 'profesional-no-vinculado'],
      [409, 'subscription-suspended', 'suscripcion-suspendida'],
      [400, 'ventana-demasiado-amplia', 'ventana-amplia'],
    ];

    for (const [status, tipo, causa] of casos) {
      const traducido = traducirErrorExcepcion(problema(status, tipo));
      expect(traducido.causa, `${tipo} deberia mapear a ${causa}`).toBe(causa);
      expect(traducido.mensaje.length).toBeGreaterThan(0);
      expect(traducido.segundosDeEspera).toBe(0);
    }
  });

  /**
   * El hueco que dejo abierto la tarea 14, cerrado aca.
   *
   * <p>`traducirErrorBloque` no ramifica `excepcion-already-inactive` —su pantalla no toca
   * excepciones— y ese codigo caia en la rama generica. "Ya estaba dada de baja" es informacion
   * distinta de "no existe": la primera dice que hay que recargar y que la fila sigue ahi con su
   * motivo; la segunda manda a buscar algo que no esta.
   */
  it('dar de baja dos veces dice "ya estaba dada de baja", no "no existe"', () => {
    const traducido = traducirErrorExcepcion(problema(409, 'excepcion-already-inactive'));

    expect(traducido.causa).toBe('ya-inactiva');
    expect(traducido.mensaje).toContain('ya estaba dada de baja');
    expect(traducido.mensaje).toContain('No es lo mismo que no existir');
  });

  it('la ventana demasiado amplia publica el tope para que la pantalla lo diga', () => {
    const traducido = traducirErrorExcepcion(
      problema(400, 'ventana-demasiado-amplia', { maximoDias: 366 }),
    );

    expect(traducido.maximoDias).toBe(366);
    expect(traducido.mensaje).toContain('366 dias');
  });

  /** Sin la extension no se inventa un numero: se dice lo que se sabe. */
  it('sin maximoDias el mensaje de ventana no menciona ningun tope', () => {
    const traducido = traducirErrorExcepcion(problema(400, 'ventana-demasiado-amplia'));

    expect(traducido.maximoDias).toBe(0);
    expect(traducido.mensaje).toContain('demasiado larga');
    expect(traducido.mensaje).not.toContain('maximo es de');
  });

  it('la sede dada de baja aclara que las excepciones cargadas si se pueden dar de baja', () => {
    const traducido = traducirErrorExcepcion(problema(409, 'consultorio-inactive'));

    expect(traducido.causa).toBe('sede-inactiva');
    expect(traducido.mensaje).toContain('si se pueden dar de baja');
  });

  it('un 429 con Retry-After propone el plazo, y sin el header no inventa uno', () => {
    const conPlazo = new AkineHttpError(
      429,
      { type: 'https://akine.app/problems/rate-limited' },
      false,
      12,
    );
    const sinPlazo = new AkineHttpError(
      429,
      { type: 'https://akine.app/problems/rate-limited' },
      false,
    );

    expect(traducirErrorExcepcion(conPlazo).segundosDeEspera).toBe(12);
    expect(traducirErrorExcepcion(conPlazo).mensaje).toContain('12 segundos');
    expect(traducirErrorExcepcion(sinPlazo).segundosDeEspera).toBe(0);
    expect(traducirErrorExcepcion(sinPlazo).mensaje).toContain('Espera un momento');
  });

  it('un fallo de red se distingue de un rechazo del servidor', () => {
    const traducido = traducirErrorExcepcion(new AkineHttpError(0, null, true));

    expect(traducido.causa).toBe('red');
    expect(traducido.mensaje).toContain('Revisa tu conexion');
  });

  it('lo que no es un error de la aplicacion cae en el mensaje generico', () => {
    expect(traducirErrorExcepcion(new Error('cualquier cosa')).causa).toBe('otro');
    expect(traducirErrorExcepcion(undefined).mensaje).toContain('No pudimos completar');
  });

  /** Un `500` sin cuerpo de Problem Details no puede mostrar la prosa del backend. */
  it('un 500 sin ProblemDetail usa el respaldo y no la palabra vacia', () => {
    const traducido = traducirErrorExcepcion(new AkineHttpError(500, null, false));

    expect(traducido.causa).toBe('otro');
    expect(traducido.mensaje).toContain('No pudimos completar');
  });

  /** Con cuerpo, el texto del backend nombra el campo y es mas util que cualquier generico. */
  it('un 400 con detalle muestra el texto del backend', () => {
    expect(traducirErrorExcepcion(problema(400, 'validation-error')).mensaje).toBe(
      'prosa del backend',
    );
  });
});
