import { AkineHttpError, ProblemDetail } from '../../../core/interceptors/error.interceptor';

import { recortarVentana, traducirErrorAgenda } from './agenda-errors';

/**
 * Arma un cuerpo de Problem Details con extensiones.
 *
 * <p>El `ProblemDetail` del contrato no declara `maxDays`, `motivo`, `cupoTotal` ni `recurso`:
 * Spring las serializa como claves de primer nivel y el tipo generado no las conoce. Esta es
 * exactamente la forma que llega por el cable, y es la que `extension()` sabe leer.
 */
function cuerpo(datos: Record<string, unknown>): ProblemDetail {
  return datos as ProblemDetail;
}

/**
 * Spec del traductor de errores de agenda (M12, AKINE-05.01 y 05.02).
 *
 * <p>Cubre <b>lo unico que decide comportamiento</b>: que cada uno de los cinco conflictos llegue
 * a su propia accion, con el dato que esa accion necesita, y que la ventana se recorte sola.
 *
 * <p>Si esto se rompe, el sintoma no es un error visible: la pantalla muestra un cartel y el
 * operador queda sin salida, que es exactamente lo que el backend evito publicando cinco tipos en
 * vez de un `conflict` generico.
 */
describe('traducirErrorAgenda', () => {
  function conflicto(tipo: string, extras: Record<string, unknown> = {}): AkineHttpError {
    return new AkineHttpError(
      409,
      cuerpo({
        type: `https://akine.app/problems/${tipo}`,
        status: 409,
        detail: 'Rechazado por el servidor.',
        ...extras,
      }),
      false,
    );
  }

  it('slot-no-disponible manda a recargar la agenda y trae el motivo', () => {
    const traducido = traducirErrorAgenda(
      conflicto('slot-no-disponible', { motivo: 'el profesional dejo de atender ese dia' }),
    );

    expect(traducido.causa).toBe('slot-no-disponible');
    expect(traducido.accion).toBe('recargar-agenda');
    expect(traducido.motivo).toBe('el profesional dejo de atender ese dia');
  });

  it('slot-completo NO manda a recargar: ofrece el siguiente, y trae el cupo total', () => {
    const traducido = traducirErrorAgenda(conflicto('slot-completo', { cupoTotal: 4 }));

    expect(traducido.causa).toBe('slot-completo');
    // Recargar mostraria el mismo horario lleno: el hueco existe, lo que se agoto es el cupo.
    expect(traducido.accion).toBe('ofrecer-siguiente');
    expect(traducido.cupoTotal).toBe(4);
  });

  it('recurso-ocupado manda a elegir otro horario o profesional, y dice cual recurso', () => {
    const traducido = traducirErrorAgenda(conflicto('recurso-ocupado', { recurso: 'profesional' }));

    expect(traducido.causa).toBe('recurso-ocupado');
    expect(traducido.accion).toBe('elegir-otro');
    expect(traducido.recurso).toBe('profesional');
  });

  it('persona-sin-perfil-paciente manda a activar el perfil, no a la agenda', () => {
    const traducido = traducirErrorAgenda(conflicto('persona-sin-perfil-paciente'));

    expect(traducido.causa).toBe('persona-sin-perfil-paciente');
    // No es un problema de agenda y por eso no se resuelve en la agenda.
    expect(traducido.accion).toBe('activar-perfil');
  });

  it('idempotency-key-conflict pide reintentar con clave nueva y no culpa al usuario', () => {
    const traducido = traducirErrorAgenda(conflicto('idempotency-key-conflict'));

    expect(traducido.causa).toBe('clave-reusada');
    expect(traducido.accion).toBe('reintentar-con-clave-nueva');
    expect(traducido.mensaje).toContain('no es un error tuyo');
  });

  /**
   * Los dos tipos del ciclo de vida (AKINE-05.03).
   *
   * <p>Estos nombres son <b>contrato</b>. Si el backend renombra `turno-con-atencion`, este
   * traductor cae en el `default`, la pantalla muestra el 409 generico y el operador vuelve a
   * quedar sin entender por que no puede cancelar un turno. El sintoma no es un test rojo ni un
   * error en consola: es un cartel inutil. Por eso los literales se fijan aca.
   */
  it('turno-transicion-no-permitida manda a releer el turno y trae el motivo', () => {
    const traducido = traducirErrorAgenda(
      conflicto('turno-transicion-no-permitida', { motivo: 'ya empezo y no se puede mover' }),
    );

    expect(traducido.causa).toBe('turno-transicion-no-permitida');
    // Releer el TURNO, no la agenda: lo que quedo viejo es la fila y su version.
    expect(traducido.accion).toBe('recargar-turno');
    expect(traducido.motivo).toBe('ya empezo y no se puede mover');
  });

  it('turno-con-atencion explica por que y manda a la atencion, no a reintentar', () => {
    const traducido = traducirErrorAgenda(conflicto('turno-con-atencion'));

    expect(traducido.causa).toBe('turno-con-atencion');
    // Reintentar devuelve el mismo 409 para siempre: lo que hay que resolver es la Sesion.
    expect(traducido.accion).toBe('resolver-atencion');
    // El requisito era explicito: esto NO se muestra como "error inesperado".
    expect(traducido.mensaje).toContain('atencion clinica registrada');
    expect(traducido.mensaje).toContain('no se puede cancelar, reprogramar ni marcar como ausente');
  });

  it('los siete conflictos publicados llevan a acciones propias, no a una bolsa comun', () => {
    const acciones = [
      'slot-no-disponible',
      'slot-completo',
      'recurso-ocupado',
      'persona-sin-perfil-paciente',
      'idempotency-key-conflict',
      'turno-transicion-no-permitida',
      'turno-con-atencion',
    ].map((tipo) => traducirErrorAgenda(conflicto(tipo)).accion);

    expect(new Set(acciones).size).toBe(acciones.length);
  });

  /**
   * La version vieja NO tiene tipo propio, y el traductor no puede inventarselo.
   *
   * <p>El backend la mapea al `conflict` generico. Este test lo fija para que el dia que
   * `scheduling` empiece a emitir `concurrent-modification` alguien se entere aca y no en
   * produccion.
   */
  it('la version vieja llega como conflicto generico y conserva el mensaje del backend', () => {
    const traducido = traducirErrorAgenda(
      conflicto('conflict', {
        detail: 'El recurso fue modificado por otra operacion. Vuelva a leerlo y reintente.',
      }),
    );

    expect(traducido.causa).toBe('conflicto');
    expect(traducido.mensaje).toContain('Vuelva a leerlo y reintente');
  });

  it('los cinco conflictos son cinco acciones distintas', () => {
    const acciones = [
      'slot-no-disponible',
      'slot-completo',
      'recurso-ocupado',
      'persona-sin-perfil-paciente',
      'idempotency-key-conflict',
    ].map((tipo) => traducirErrorAgenda(conflicto(tipo)).accion);

    // Es la afirmacion que sostiene toda la etapa: colapsar dos de estas acciones deja al
    // operador sin la salida de uno de los casos.
    expect(new Set(acciones).size).toBe(5);
  });

  it('ventana-demasiado-amplia trae maxDays para que la pantalla recorte sola', () => {
    const error = new AkineHttpError(
      400,
      cuerpo({
        type: 'https://akine.app/problems/ventana-demasiado-amplia',
        status: 400,
        detail: 'Ventana demasiado amplia.',
        maxDays: 62,
      }),
      false,
    );

    const traducido = traducirErrorAgenda(error);

    expect(traducido.causa).toBe('ventana-demasiado-amplia');
    expect(traducido.maxDias).toBe(62);
    expect(traducido.mensaje).toContain('62');
  });

  it('lee las extensiones tambien cuando llegan anidadas bajo properties', () => {
    const error = new AkineHttpError(
      409,
      cuerpo({
        type: 'https://akine.app/problems/slot-completo',
        status: 409,
        detail: 'Sin cupo.',
        properties: { cupoTotal: 3 },
      }),
      false,
    );

    // Spring las serializa en la raiz y el contrato las declara anidadas: hay que soportar las dos.
    expect(traducirErrorAgenda(error).cupoTotal).toBe(3);
  });

  it('los rechazos que NO son de agenda no ofrecen una accion de agenda', () => {
    // Cada uno lleva a otro lado, y ninguno se arregla recargando la grilla: sin contexto se
    // elige contexto, sin permiso no hay nada que el usuario pueda hacer solo, y la suscripcion
    // suspendida se resuelve en otra pantalla.
    const sinContexto = traducirErrorAgenda(
      new AkineHttpError(
        403,
        cuerpo({ type: 'https://akine.app/problems/missing-tenant-context', status: 403 }),
        false,
      ),
    );
    expect(sinContexto.causa).toBe('sin-contexto');
    expect(sinContexto.accion).toBe('elegir-contexto');

    const sinPermiso = traducirErrorAgenda(
      new AkineHttpError(
        403,
        cuerpo({ type: 'https://akine.app/problems/forbidden', status: 403 }),
        false,
      ),
    );
    expect(sinPermiso.causa).toBe('sin-permiso');
    expect(sinPermiso.accion).toBe('ninguna');

    const suspendida = traducirErrorAgenda(
      new AkineHttpError(
        409,
        cuerpo({ type: 'https://akine.app/problems/subscription-suspended', status: 409 }),
        false,
      ),
    );
    expect(suspendida.causa).toBe('suscripcion-suspendida');
    expect(suspendida.accion).toBe('ninguna');
  });

  it('la oferta de baja y la no agendable dicen lo mismo: no se puede agendar', () => {
    for (const tipo of ['oferta-inactiva', 'oferta-no-agendable']) {
      expect(traducirErrorAgenda(conflicto(tipo)).causa).toBe('oferta-no-agendable');
    }
  });

  it('el 404 manda a releer, y el 409 desconocido conserva el mensaje del backend', () => {
    const noEncontrado = traducirErrorAgenda(
      new AkineHttpError(
        404,
        cuerpo({ type: 'https://akine.app/problems/not-found', status: 404 }),
        false,
      ),
    );
    expect(noEncontrado.causa).toBe('no-encontrado');
    expect(noEncontrado.accion).toBe('recargar-agenda');

    // AGENT.md 8: el mensaje real del backend, no un generico que tira a la basura lo unico
    // accionable que trae la respuesta.
    const otro = traducirErrorAgenda(
      new AkineHttpError(
        409,
        cuerpo({
          type: 'https://akine.app/problems/conflict',
          status: 409,
          detail: 'Algo raro paso.',
        }),
        false,
      ),
    );
    expect(otro.causa).toBe('conflicto');
    expect(otro.mensaje).toBe('Algo raro paso.');
  });

  it('sin red y con rate limit no se inventa una accion', () => {
    const red = traducirErrorAgenda(new AkineHttpError(0, null, true));
    expect(red.causa).toBe('red');

    const conPlazo = traducirErrorAgenda(new AkineHttpError(429, null, false, 12));
    expect(conPlazo.causa).toBe('limite');
    expect(conPlazo.segundosDeEspera).toBe(12);

    // Sin `Retry-After` no se inventa un numero de segundos.
    const sinPlazo = traducirErrorAgenda(new AkineHttpError(429, null, false));
    expect(sinPlazo.segundosDeEspera).toBe(0);

    // Lo que no es un error HTTP tampoco se muestra crudo.
    expect(traducirErrorAgenda(new Error('boom')).causa).toBe('otro');
  });

  it('sin maxDays el mensaje no promete un recorte que no puede hacer', () => {
    const traducido = traducirErrorAgenda(conflicto('ventana-demasiado-amplia'));

    expect(traducido.maxDias).toBe(0);
    expect(traducido.mensaje).not.toContain('recortamos');
  });

  it('una extension con el tipo equivocado no se muestra cruda', () => {
    const traducido = traducirErrorAgenda(conflicto('slot-no-disponible', { motivo: 42 }));

    expect(traducido.motivo).toBe('');
  });
});

describe('recortarVentana', () => {
  it('devuelve desde + maxDias, que es el `hasta` exclusivo que el backend acepta', () => {
    expect(recortarVentana('2026-09-15', 62)).toBe('2026-11-16');
  });

  it('sin un maximo utilizable no inventa un ancho', () => {
    // Adivinar la regla del servidor daria un segundo 400 y un bucle de reintentos.
    expect(recortarVentana('2026-09-15', 0)).toBeNull();
    expect(recortarVentana('2026-09-15', -1)).toBeNull();
    expect(recortarVentana('no es una fecha', 62)).toBeNull();
  });
});
