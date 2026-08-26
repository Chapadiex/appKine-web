import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { CausaBloque, traducirErrorBloque } from './bloque-errors';

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
 * Spec del mapeo de errores de bloques de disponibilidad (M05, AKINE-02.04).
 *
 * <p>Mismo formato de tabla que `espacio-errors.spec.ts`, y por el mismo motivo: el fallo que
 * importa es <b>silencioso</b>. Un `type` mal escrito hace que `problemType` devuelva `null`,
 * el `switch` cae al `default` y el usuario recibe "no pudimos completar la operacion" sobre un
 * conflicto que la pantalla sabia explicar.
 */
describe('traducirErrorBloque', () => {
  it('cada problem type llega a su causa propia y ninguno cae en la generica', () => {
    const casos: readonly (readonly [number, string, CausaBloque])[] = [
      [403, 'missing-tenant-context', 'sin-contexto'],
      [403, 'forbidden', 'sin-permiso'],
      [400, 'validation-error', 'validacion'],
      [404, 'not-found', 'no-encontrado'],
      [409, 'bloque-solapado', 'solapado'],
      [409, 'bloque-inactivo', 'bloque-inactivo'],
      [409, 'bloque-already-inactive', 'ya-inactivo'],
      [409, 'conflict', 'concurrencia'],
      [409, 'profesional-no-vinculado', 'profesional-no-vinculado'],
      [409, 'consultorio-inactive', 'sede-inactiva'],
      [409, 'subscription-suspended', 'suscripcion-suspendida'],
      [400, 'ventana-demasiado-amplia', 'ventana-amplia'],
    ];

    for (const [status, tipo, causa] of casos) {
      const traducido = traducirErrorBloque(problema(status, tipo));
      expect(traducido.causa, `${tipo} deberia mapear a ${causa}`).toBe(causa);
      expect(traducido.mensaje.length).toBeGreaterThan(0);
      expect(traducido.segundosDeEspera).toBe(0);
    }
  });

  /**
   * La version vieja llega como `conflict`, el generico.
   *
   * <p>`concurrent-modification` es el que emite `organization` para el mismo hecho, y
   * `resource` no lo reusa para disponibilidad. Ramificar por el codigo equivocado dejaria el
   * unico error del modulo donde hay que RECARGAR antes de reintentar cayendo en la rama
   * generica, que solo dice "volve a intentar".
   */
  it('la version vieja de un bloque llega como conflict, no como concurrent-modification', () => {
    expect(traducirErrorBloque(problema(409, 'conflict')).causa).toBe('concurrencia');
    expect(traducirErrorBloque(problema(409, 'conflict')).mensaje).toContain('Recarga el horario');
  });

  it('el solapamiento publica el bloque en conflicto y lo nombra en el mensaje', () => {
    const traducido = traducirErrorBloque(
      problema(409, 'bloque-solapado', {
        bloqueEnConflictoId: 77,
        diaSemana: 3,
        horaDesde: '09:00',
        horaHasta: '12:00',
      }),
    );

    // Sin el id no se puede senalar la fila, y sin la fila el mensaje es inaccionable.
    expect(traducido.conflicto).toEqual({
      id: 77,
      diaSemana: 3,
      horaDesde: '09:00',
      horaHasta: '12:00',
    });
    expect(traducido.mensaje).toContain('el bloque del miercoles de 09:00 a 12:00');
    // Y aclara lo que el usuario esta por corregir mal: contiguo no es solapado.
    expect(traducido.mensaje).toContain('la hora de fin es exclusiva');
  });

  it('un solapamiento sin extensiones degrada a un mensaje sin senalamiento, no rompe', () => {
    // Un Problem Details puede llegar sin extensiones -un proxy que recorta, una version mas
    // vieja del backend-. La pantalla pierde la marca, no la pantalla entera.
    const traducido = traducirErrorBloque(problema(409, 'bloque-solapado'));

    expect(traducido.causa).toBe('solapado');
    expect(traducido.conflicto).toEqual({
      id: null,
      diaSemana: null,
      horaDesde: null,
      horaHasta: null,
    });
    expect(traducido.mensaje).toContain('NO se pisan');
  });

  it('la medianoche se nombra en palabras: 24:00 a secas se lee como un error de carga', () => {
    const traducido = traducirErrorBloque(
      problema(409, 'bloque-solapado', {
        bloqueEnConflictoId: 5,
        diaSemana: 1,
        horaDesde: '20:00',
        horaHasta: '24:00',
      }),
    );

    expect(traducido.mensaje).toContain('20:00 a medianoche (24:00)');
  });

  it('la ventana demasiado amplia trae el tope para que la pantalla recorte sola', () => {
    const traducido = traducirErrorBloque(
      problema(400, 'ventana-demasiado-amplia', { maximoDias: 366 }),
    );

    expect(traducido.causa).toBe('ventana-amplia');
    expect(traducido.maximoDias).toBe(366);
  });

  it('falta de contexto no es falta de permiso: manda a elegir sede, nunca al login', () => {
    // Los dos son 403 y tienen salidas opuestas. Tratarlos igual manda a re-autenticarse a
    // alguien cuyas credenciales estan bien.
    expect(traducirErrorBloque(problema(403, 'missing-tenant-context')).mensaje).toContain(
      'Eligi un consultorio',
    );
    expect(traducirErrorBloque(problema(403, 'forbidden')).mensaje).toContain('No tenes permiso');
  });

  it('el 429 respeta el plazo del servidor y no inventa uno cuando no viene', () => {
    const conPlazo = new AkineHttpError(429, null, false, 12.4);
    expect(traducirErrorBloque(conPlazo).causa).toBe('limite');
    expect(traducirErrorBloque(conPlazo).segundosDeEspera).toBe(13);

    const sinPlazo = new AkineHttpError(429, null, false);
    expect(traducirErrorBloque(sinPlazo).segundosDeEspera).toBe(0);
    expect(traducirErrorBloque(sinPlazo).mensaje).toContain('Espera un momento');
  });

  it('lo que no es un AkineHttpError, y lo que nunca llego a la red, tienen su propia salida', () => {
    expect(traducirErrorBloque(new Error('cualquier cosa')).causa).toBe('otro');

    const deRed = new AkineHttpError(0, null, true);
    expect(traducirErrorBloque(deRed).causa).toBe('red');
    expect(traducirErrorBloque(deRed).mensaje).toContain('Revisa tu conexion');
  });

  it('un tipo desconocido cae en la generica con el detalle del backend, no con un texto fijo', () => {
    // El backend nombra el campo concreto en un 400; ningun generico de aca lo supera.
    const traducido = traducirErrorBloque(problema(422, 'algo-que-este-cliente-no-conoce'));
    expect(traducido.causa).toBe('otro');
    expect(traducido.mensaje.length).toBeGreaterThan(0);
  });
});
