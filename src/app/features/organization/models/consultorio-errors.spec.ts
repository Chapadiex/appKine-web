import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { CausaConsultorio, traducirErrorConsultorio } from './consultorio-errors';

/** Arma el error como lo entrega el `errorInterceptor` a partir de un `ProblemDetail`. */
function problema(
  status: number,
  type: string,
  extra: Record<string, unknown> = {},
): AkineHttpError {
  return new AkineHttpError(
    status,
    { type: `https://akine.app/problems/${type}`, detail: 'Detalle del backend', ...extra },
    false,
  );
}

/**
 * Spec de la traduccion de errores de sedes (M01, AKINE-02.01).
 *
 * <p><b>Por que hay un test por fila de la tabla y no uno por pantalla.</b> Esta funcion es
 * la tabla de errores del modulo: doce situaciones del backend que tienen que llegar a
 * pantalla como doce salidas distintas. Si dos se confunden, la pantalla ofrece la accion
 * equivocada —"reintentar" ante un tope de plan, por ejemplo— y no hay ningun sintoma que lo
 * delate: el mensaje se ve prolijo y es inutil. Se ejercita aca una vez, y las pantallas no
 * repiten el mapeo.
 *
 * <p>Lo que se verifica de cada caso es la <b>causa</b>, que es por lo que ramifican las
 * pantallas. Solo se mira el texto donde el texto es la decision: los dos mensajes que el
 * frontend redacta en lugar de mostrar el `detail` del backend.
 */
describe('traducirErrorConsultorio', () => {
  const casos: readonly (readonly [string, AkineHttpError, CausaConsultorio])[] = [
    ['sede u organizacion de otro tenant', problema(404, 'not-found'), 'no-encontrado'],
    ['falta consultorio:manage', problema(403, 'forbidden'), 'sin-permiso'],
    ['sin contexto elegido', problema(403, 'missing-tenant-context'), 'sin-contexto'],
    ['nombre repetido entre vigentes', problema(409, 'consultorio-name-taken'), 'conflicto'],
    ['tope del plan', problema(409, 'plan-limit-exceeded'), 'tope-del-plan'],
    ['suscripcion suspendida', problema(409, 'subscription-suspended'), 'conflicto'],
    ['editar una sede inactiva', problema(409, 'consultorio-inactive'), 'conflicto'],
    ['bajar una ya inactiva', problema(409, 'consultorio-already-inactive'), 'conflicto'],
    ['bajar la ultima activa', problema(409, 'last-consultorio-required'), 'ultima-sede'],
    ['version vieja', problema(409, 'concurrent-modification'), 'concurrencia'],
    ['misma clave, otro cuerpo', problema(409, 'idempotency-key-conflict'), 'clave-repetida'],
    ['zona no IANA o motivo vacio', problema(400, 'validation-error'), 'validacion'],
  ];

  it.each(casos)('%s', (_nombre, error, causa) => {
    expect(traducirErrorConsultorio(error).causa).toBe(causa);
  });

  it('el request que nunca llego se distingue de un error del servidor', () => {
    const traducido = traducirErrorConsultorio(new AkineHttpError(0, null, true));

    expect(traducido.causa).toBe('red');
    expect(traducido.mensaje).toContain('Revisa tu conexion');
  });

  it('el 429 propaga los segundos de Retry-After, y sin header no inventa un plazo', () => {
    const conPlazo = new AkineHttpError(
      429,
      { type: 'https://akine.app/problems/rate-limited' },
      false,
      45,
    );
    const sinPlazo = new AkineHttpError(
      429,
      { type: 'https://akine.app/problems/rate-limited' },
      false,
      null,
    );

    expect(traducirErrorConsultorio(conPlazo).segundosDeEspera).toBe(45);
    expect(traducirErrorConsultorio(conPlazo).mensaje).toContain('45 segundos');
    // Sin header no se promete un numero: uno inventado deja al usuario esperando de mas, o
    // le promete que ya puede y se come otro 429.
    expect(traducirErrorConsultorio(sinPlazo).segundosDeEspera).toBe(0);
  });

  it('el tope del plan usa el limite y el consumo, y no el detail tecnico del backend', () => {
    const unaSede = traducirErrorConsultorio(
      problema(409, 'plan-limit-exceeded', {
        limitCode: 'MAX_CONSULTORIOS',
        limitValue: 1,
        currentUsage: 1,
      }),
    ).mensaje;
    const variasSedes = traducirErrorConsultorio(
      problema(409, 'plan-limit-exceeded', { limitValue: 3, currentUsage: 3 }),
    ).mensaje;
    const sinDatos = traducirErrorConsultorio(problema(409, 'plan-limit-exceeded')).mensaje;

    expect(unaSede).toContain('una sola sede');
    expect(variasSedes).toContain('hasta 3 sedes y ya tenes 3');
    // Sin los datos del limite se dice lo mismo sin numeros: sigue siendo accionable.
    expect(sinDatos).toContain('cambiar a un plan');
    expect(unaSede).not.toContain('Detalle del backend');
  });

  it('la ultima sede activa se explica, no se muestra como un conflicto a secas', () => {
    const mensaje = traducirErrorConsultorio(problema(409, 'last-consultorio-required')).mensaje;

    expect(mensaje).toContain('unica sede activa');
    expect(mensaje).toContain('primero da de alta la sede nueva');
    expect(mensaje).not.toContain('Detalle del backend');
  });

  it('en el resto de los conflictos gana el detail del backend, y el 404 lo puede sobreescribir la pantalla', () => {
    expect(traducirErrorConsultorio(problema(409, 'consultorio-name-taken')).mensaje).toBe(
      'Detalle del backend',
    );
    expect(
      traducirErrorConsultorio(problema(404, 'not-found'), { noEncontrado: 'Sede inexistente' })
        .mensaje,
    ).toBe('Sede inexistente');
  });

  it('algo que no es un error HTTP cae en el mensaje generico', () => {
    const traducido = traducirErrorConsultorio(new Error('boom'));

    expect(traducido.causa).toBe('otro');
    expect(traducido.mensaje).toContain('No pudimos completar la operacion');
  });

  it('un 500 sin cuerpo no muestra el texto interno del interceptor como si fuera del backend', () => {
    const traducido = traducirErrorConsultorio(new AkineHttpError(500, null, false));

    expect(traducido.causa).toBe('otro');
    expect(traducido.mensaje).toContain('No pudimos completar la operacion');
  });
});
