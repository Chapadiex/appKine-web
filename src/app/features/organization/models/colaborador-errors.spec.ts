import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { CausaColaborador, traducirErrorColaborador } from './colaborador-errors';

/** Arma el error tal como lo entrega `errorInterceptor` a las pantallas. */
function problema(status: number, tipo: string | null, detail = 'Detalle del backend') {
  return new AkineHttpError(
    status,
    tipo === null ? null : { type: `https://akine.app/problems/${tipo}`, detail },
    false,
  );
}

/**
 * Spec del mapeo de errores de colaboradores y auditoria (AKINE-01.03).
 *
 * <p>Es una funcion pura que consumen las tres pantallas de la etapa, asi que se prueba una
 * vez aca en vez de tres veces a traves del DOM. Lo que importa es que <b>cada respuesta del
 * contrato caiga en su causa</b>: la causa es lo que decide si la pantalla ofrece el selector
 * de contexto, un reintento, o nada mas que el mensaje.
 *
 * <p>El caso que mas facil se rompe es el `403`: `missing-tenant-context` y `forbidden`
 * comparten codigo HTTP y llevan a acciones opuestas -mandar a elegir contexto, o explicar
 * que falta permiso-. Ramificar por el status y no por el `type` los confunde.
 */
describe('traducirErrorColaborador', () => {
  const casos: readonly [string, AkineHttpError, CausaColaborador][] = [
    ['403 sin contexto', problema(403, 'missing-tenant-context'), 'sin-contexto'],
    ['403 sin permiso', problema(403, 'forbidden'), 'sin-permiso'],
    ['400 de validacion', problema(400, 'validation-error'), 'validacion'],
    ['404 no encontrado', problema(404, 'not-found'), 'no-encontrado'],
    ['409 vinculo duplicado', problema(409, 'membership-already-exists'), 'conflicto'],
    ['409 ultimo administrador', problema(409, 'last-admin-required'), 'conflicto'],
    ['500 del servidor', problema(500, 'internal-error'), 'otro'],
  ];

  for (const [nombre, error, esperada] of casos) {
    it(`un ${nombre} se traduce a la causa ${esperada}`, () => {
      expect(traducirErrorColaborador(error).causa).toBe(esperada);
    });
  }

  it('muestra el detail del backend y no un texto generico nuestro', () => {
    const traducido = traducirErrorColaborador(
      problema(409, 'last-admin-required', 'No podes revocar al ultimo administrador'),
    );

    // AGENT.md seccion 8: el backend ya lo redacto para el usuario final, y en los conflictos
    // es la unica informacion accionable. Un "ocurrio un error" tira eso a la basura.
    expect(traducido.mensaje).toBe('No podes revocar al ultimo administrador');
  });

  it('un cuerpo sin ProblemDetail cae en el texto de respaldo', () => {
    expect(traducirErrorColaborador(problema(500, null)).mensaje).toContain('No pudimos completar');
  });

  it('un 404 puede sobreescribirse por pantalla, que es lo unico que cambia entre ellas', () => {
    const traducido = traducirErrorColaborador(problema(404, 'not-found'), {
      noEncontrado: 'No existe una cuenta con ese email',
    });

    expect(traducido.mensaje).toBe('No existe una cuenta con ese email');
  });

  it('un fallo de red no se confunde con un rechazo del servidor', () => {
    const traducido = traducirErrorColaborador(new AkineHttpError(0, null, true));

    expect(traducido.causa).toBe('red');
    expect(traducido.mensaje).toContain('No se pudo contactar');
  });

  it('un 429 con Retry-After propaga los segundos declarados', () => {
    const traducido = traducirErrorColaborador(
      new AkineHttpError(429, { type: 'https://akine.app/problems/rate-limited' }, false, 45),
    );

    expect(traducido.causa).toBe('limite');
    expect(traducido.segundosDeEspera).toBe(45);
    expect(traducido.mensaje).toContain('45');
  });

  it('un 429 SIN Retry-After no inventa una espera', () => {
    const traducido = traducirErrorColaborador(
      new AkineHttpError(429, { type: 'https://akine.app/problems/rate-limited' }, false, null),
    );

    // Prometer "60 segundos" sin saberlo deja al usuario esperando de mas, o lo manda a
    // comerse otro 429 —y en el alta de colaborador cada intento fallido queda auditado—.
    expect(traducido.segundosDeEspera).toBe(0);
    expect(traducido.mensaje).not.toMatch(/\d/);
  });

  it('algo que no es un AkineHttpError no rompe el mapeo', () => {
    const traducido = traducirErrorColaborador(new TypeError('undefined is not a function'));

    expect(traducido.causa).toBe('otro');
    expect(traducido.mensaje).toContain('No pudimos completar');
  });
});
