import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { hayQueRecargar, traducirErrorPersona } from './person-errors';

/**
 * Spec del traductor de errores del padron (M07, AKINE-03.01).
 *
 * <p><b>Por que este archivo existe.</b> Una rama mal escrita aca no rompe nada: cae en el caso
 * por defecto y el usuario ve el mensaje generico en vez del que le sirve. Es exactamente el tipo
 * de defecto que ningun test de pantalla encuentra, porque la pantalla sigue funcionando.
 *
 * <p>Lo que mas importa son los dos 409 del alta: si se confundieran, el operador con un documento
 * repetido veria un boton de "confirmar" que lo lleva al mismo error para siempre.
 */
describe('traducirErrorPersona', () => {
  it('distingue el documento repetido del posible duplicado', () => {
    const duro = traducirErrorPersona(
      problema('persona-documento-taken', 409, { personaExistenteId: 42 }),
    );
    expect(duro.causa).toBe('documento-en-uso');
    expect(duro.personaExistenteId).toBe(42);
    // El invariante duro no lleva candidatos: no hay nada que elegir.
    expect(duro.candidatos).toEqual([]);

    const blando = traducirErrorPersona(
      problema('persona-posible-duplicado', 409, { candidatos: [10, 11] }),
    );
    expect(blando.causa).toBe('posible-duplicado');
    expect(blando.candidatos).toEqual([10, 11]);
    expect(blando.personaExistenteId).toBeNull();
  });

  it('descarta los candidatos que no son numeros', () => {
    // El cuerpo de un Problem Details lleva propiedades extra sin tipo. Un `null` colado en la
    // lista terminaria en un `GET /personas/null`.
    const traducido = traducirErrorPersona(
      problema('persona-posible-duplicado', 409, { candidatos: [10, null, 'doce', 13] }),
    );

    expect(traducido.candidatos).toEqual([10, 13]);
  });

  it('tolera un 409 de duplicado sin la propiedad extra', () => {
    const traducido = traducirErrorPersona(problema('persona-posible-duplicado', 409, {}));

    expect(traducido.causa).toBe('posible-duplicado');
    expect(traducido.candidatos).toEqual([]);
  });

  it('la persona inactiva es su propia causa, no un conflicto generico', () => {
    // Importa porque el remedio es distinto: no hay nada que recargar ni que reintentar, la ficha
    // simplemente esta dada de baja.
    expect(traducirErrorPersona(problema('persona-inactiva', 409, {})).causa).toBe(
      'persona-inactiva',
    );
  });

  it('la falta de contexto NO es una sesion vencida, y el mensaje lo dice', () => {
    const traducido = traducirErrorPersona(problema('missing-tenant-context', 403, {}));

    expect(traducido.causa).toBe('sin-contexto');
    expect(traducido.mensaje).toContain('sesion sigue abierta');
  });

  it('el 409 de concurrencia llega como conflict, y tambien se reconoce el otro tipo', () => {
    expect(traducirErrorPersona(problema('conflict', 409, {})).causa).toBe('concurrencia');
    // `person` no emite `concurrent-modification` hoy. Se reconoce por si algun dia se unifican.
    expect(traducirErrorPersona(problema('concurrent-modification', 409, {})).causa).toBe(
      'concurrencia',
    );
  });

  it('un 403 sin tipo conocido es falta de permiso, y un 404 es no encontrado', () => {
    expect(traducirErrorPersona(sinTipo(403)).causa).toBe('sin-permiso');
    expect(traducirErrorPersona(sinTipo(404)).causa).toBe('no-encontrado');
  });

  it('un error que no es de AKINE cae en el generico sin romperse', () => {
    const traducido = traducirErrorPersona(new Error('cualquier cosa'));

    expect(traducido.causa).toBe('otro');
    expect(traducido.candidatos).toEqual([]);
  });

  it('un fallo de red se distingue de un rechazo del servidor', () => {
    const traducido = traducirErrorPersona(new AkineHttpError(0, null, true));

    expect(traducido.causa).toBe('red');
  });

  it('el 429 dice cuantos segundos esperar cuando el backend los declara', () => {
    const conPlazo = traducirErrorPersona(
      new AkineHttpError(429, { status: 429, detail: 'muchos intentos' }, false, 12),
    );
    expect(conPlazo.causa).toBe('limite');
    expect(conPlazo.segundosDeEspera).toBe(12);
    expect(conPlazo.mensaje).toContain('12 segundos');

    // Sin  no se inventa un numero: se dice que espere, sin prometer cuanto.
    const sinPlazo = traducirErrorPersona(
      new AkineHttpError(429, { status: 429, detail: 'muchos intentos' }, false, null),
    );
    expect(sinPlazo.segundosDeEspera).toBe(0);
    expect(sinPlazo.mensaje).toContain('Espera un momento');
  });

  it('un 400 y un 409 sin tipo propio muestran el detalle del backend', () => {
    // Donde el frontend no sabe nada mejor que decir, gana el mensaje del servidor: en un 400
    // nombra el campo, y en un 409 sin tipo nombra el conflicto concreto.
    expect(traducirErrorPersona(sinTipo(400)).mensaje).toContain('sin tipo');
    expect(traducirErrorPersona(sinTipo(400)).causa).toBe('validacion');
    expect(traducirErrorPersona(sinTipo(409)).causa).toBe('conflicto');
  });

  it('un cuerpo sin ProblemDetail cae en el mensaje de respaldo', () => {
    // Un 500 de un proxy no trae cuerpo: mostrar una cadena vacia seria peor que el generico.
    const traducido = traducirErrorPersona(new AkineHttpError(500, null, false));

    expect(traducido.causa).toBe('otro');
    expect(traducido.mensaje).toContain('No pudimos completar');
  });

  it('la suscripcion suspendida manda a la pantalla de suscripcion', () => {
    const traducido = traducirErrorPersona(problema('subscription-suspended', 409, {}));

    expect(traducido.causa).toBe('suscripcion-suspendida');
    expect(traducido.mensaje).toContain('suscripcion');
  });

  it('hayQueRecargar solo pide recargar donde recargar sirve', () => {
    expect(hayQueRecargar('no-encontrado')).toBe(true);
    expect(hayQueRecargar('concurrencia')).toBe(true);
    // Recargar el listado no resuelve un documento repetido ni una falta de permiso: el remedio
    // es otro, y ofrecer un boton que no arregla nada es peor que no ofrecerlo.
    expect(hayQueRecargar('documento-en-uso')).toBe(false);
    expect(hayQueRecargar('sin-permiso')).toBe(false);
    expect(hayQueRecargar(null)).toBe(false);
  });
});

function problema(tipo: string, status: number, extra: Record<string, unknown>): AkineHttpError {
  // Se arma como lo entrega `errorInterceptor`: las extensiones de Spring llegan como claves de
  // primer nivel del cuerpo, no anidadas bajo `properties`.
  return new AkineHttpError(
    status,
    {
      type: `https://akine.app/problems/${tipo}`,
      title: tipo,
      status,
      detail: 'Detalle del backend.',
      ...extra,
    },
    false,
  );
}

function sinTipo(status: number): AkineHttpError {
  return new AkineHttpError(status, { status, detail: 'sin tipo' }, false);
}
