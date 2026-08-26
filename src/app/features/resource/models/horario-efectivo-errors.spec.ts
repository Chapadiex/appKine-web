import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { CausaHorarioEfectivo, traducirErrorHorarioEfectivo } from './horario-efectivo-errors';

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
 * Spec del mapeo de errores de la disponibilidad efectiva (M05, AKINE-02.04).
 *
 * <p>La pantalla <b>solo lee</b>, y ese es el motivo de que este traductor exista aparte: los
 * dos que ya habia redactan desde la mutacion, y "no tenes permiso para administrar los cierres"
 * en una pantalla sin ningun boton de guardar hace que se pida el permiso equivocado.
 */
describe('traducirErrorHorarioEfectivo', () => {
  it('cada problem type llega a su causa propia y ninguno cae en la generica', () => {
    const casos: readonly (readonly [number, string, CausaHorarioEfectivo])[] = [
      [403, 'missing-tenant-context', 'sin-contexto'],
      [403, 'forbidden', 'sin-permiso'],
      [400, 'validation-error', 'validacion'],
      [404, 'not-found', 'no-encontrado'],
      [400, 'ventana-demasiado-amplia', 'ventana-amplia'],
    ];

    for (const [status, tipo, causa] of casos) {
      const traducido = traducirErrorHorarioEfectivo(problema(status, tipo));
      expect(traducido.causa, `${tipo} deberia mapear a ${causa}`).toBe(causa);
      expect(traducido.mensaje.length).toBeGreaterThan(0);
      expect(traducido.segundosDeEspera).toBe(0);
    }
  });

  /** El permiso que hace falta es el de LECTURA, y el texto lo nombra para no pedir el otro. */
  it('el 403 pide colaborador:read y no habla de administrar nada', () => {
    const traducido = traducirErrorHorarioEfectivo(problema(403, 'forbidden'));

    expect(traducido.mensaje).toContain('colaborador:read');
    expect(traducido.mensaje).not.toContain('administrar');
  });

  it('la falta de contexto manda a elegir sede y nunca se confunde con falta de permiso', () => {
    const traducido = traducirErrorHorarioEfectivo(problema(403, 'missing-tenant-context'));

    expect(traducido.causa).toBe('sin-contexto');
    expect(traducido.mensaje).toContain('Eligi un consultorio');
  });

  it('la ventana demasiado amplia publica el tope para que la pantalla lo diga', () => {
    const traducido = traducirErrorHorarioEfectivo(
      problema(400, 'ventana-demasiado-amplia', { maximoDias: 366 }),
    );

    expect(traducido.maximoDias).toBe(366);
    expect(traducido.mensaje).toContain('366 dias');
  });

  /** Sin la extension no se inventa un numero: se dice lo que se sabe. */
  it('sin maximoDias el mensaje de ventana no menciona ningun tope', () => {
    const traducido = traducirErrorHorarioEfectivo(problema(400, 'ventana-demasiado-amplia'));

    expect(traducido.maximoDias).toBe(0);
    expect(traducido.mensaje).toContain('demasiado larga');
    expect(traducido.mensaje).not.toContain('maximo es de');
  });

  it('el 404 no distingue inexistente de otro tenant', () => {
    const traducido = traducirErrorHorarioEfectivo(problema(404, 'not-found'));

    expect(traducido.causa).toBe('no-encontrado');
    expect(traducido.mensaje).toContain('ya no existen');
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

    expect(traducirErrorHorarioEfectivo(conPlazo).segundosDeEspera).toBe(12);
    expect(traducirErrorHorarioEfectivo(conPlazo).mensaje).toContain('12 segundos');
    expect(traducirErrorHorarioEfectivo(sinPlazo).segundosDeEspera).toBe(0);
    expect(traducirErrorHorarioEfectivo(sinPlazo).mensaje).toContain('Espera un momento');
  });

  it('un fallo de red se distingue de un rechazo del servidor', () => {
    const traducido = traducirErrorHorarioEfectivo(new AkineHttpError(0, null, true));

    expect(traducido.causa).toBe('red');
    expect(traducido.mensaje).toContain('Revisa tu conexion');
  });

  it('lo que no es un error de la aplicacion cae en el mensaje generico', () => {
    expect(traducirErrorHorarioEfectivo(new Error('cualquier cosa')).causa).toBe('otro');
    expect(traducirErrorHorarioEfectivo(undefined).mensaje).toContain('No pudimos resolver');
  });

  /** Un `500` sin cuerpo de Problem Details no puede mostrar la prosa del backend. */
  it('un 500 sin ProblemDetail usa el respaldo y no la palabra vacia', () => {
    const traducido = traducirErrorHorarioEfectivo(new AkineHttpError(500, null, false));

    expect(traducido.causa).toBe('otro');
    expect(traducido.mensaje).toContain('No pudimos resolver');
  });

  /** Con cuerpo, el texto del backend nombra el campo y es mas util que cualquier generico. */
  it('un 400 con detalle muestra el texto del backend', () => {
    expect(traducirErrorHorarioEfectivo(problema(400, 'validation-error')).mensaje).toBe(
      'prosa del backend',
    );
  });
});
