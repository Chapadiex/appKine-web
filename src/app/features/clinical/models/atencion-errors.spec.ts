import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { traducirErrorAtencion } from './atencion-errors';

/**
 * Spec del traductor de errores de la atencion (M14, AKINE-06.01 y 06.02).
 *
 * <p>Lo unico que verifica es la <b>causa</b>, que es lo que la pantalla ramifica. Los textos no
 * se fijan: son prosa y cambian cuando alguien corrige una redaccion, y un test que los copie
 * convierte cada correccion editorial en un build roto.
 */
describe('traducirErrorAtencion', () => {
  it.each([
    ['sesion-ajena', 409, 'sesion-ajena'],
    ['turno-no-atendible', 409, 'turno-no-atendible'],
    ['concurrent-modification', 409, 'version-vieja'],
    ['validation-error', 400, 'validacion'],
  ])('mapea %s por problemType, no por el texto de detail', (tipo, status, causa) => {
    // El `detail` dice una cosa distinta a proposito: si el traductor lo mirara, fallaria aca.
    expect(traducirErrorAtencion(problema(tipo, status, 'texto que no dice nada')).causa).toBe(
      causa,
    );
  });

  it('rescata el motivo de turno-no-atendible, que es lo unico accionable del rechazo', () => {
    const error = new AkineHttpError(
      409,
      {
        type: 'https://akine.app/problems/turno-no-atendible',
        status: 409,
        detail: 'No atendible.',
        properties: { motivo: 'El turno esta cancelado' },
      },
      false,
    );

    expect(traducirErrorAtencion(error).motivo).toBe('El turno esta cancelado');
  });

  it('un 403 crudo NO se confunde con sesion-ajena: uno es permiso y el otro propiedad', () => {
    expect(traducirErrorAtencion(problema('forbidden', 403, 'Sin permiso.')).causa).toBe(
      'sin-permiso',
    );
  });

  // -------------------------------------------------------------------------------------
  // Lo que nunca llego a ser una respuesta del backend
  // -------------------------------------------------------------------------------------

  it('lo que no es un AkineHttpError cae en la generica', () => {
    expect(traducirErrorAtencion(new Error('cualquier cosa')).causa).toBe('otro');
  });

  it('un error de red avisa que lo escrito NO se guardo y pide no cerrar la pantalla', () => {
    const traducido = traducirErrorAtencion(new AkineHttpError(0, null, true));

    expect(traducido.causa).toBe('red');
    // Es la unica rama donde el usuario tiene texto sin guardar en la mano: si el mensaje no lo
    // dice, cierra la pantalla y lo pierde.
    expect(traducido.mensaje).toContain('No cierres esta pantalla');
  });

  it('el rate limit se reconoce por el 429 aunque no traiga problemType', () => {
    expect(traducirErrorAtencion(sinCuerpo(429)).causa).toBe('limite');
  });

  // -------------------------------------------------------------------------------------
  // Los rechazos que mandan al usuario a otro lado
  // -------------------------------------------------------------------------------------

  it('missing-tenant-context no es falta de permiso: manda a elegir contexto', () => {
    const traducido = traducirErrorAtencion(problema('missing-tenant-context', 400, 'Sin sede.'));

    expect(traducido.causa).toBe('sin-contexto');
    expect(traducido.mensaje).toContain('sesion sigue abierta');
  });

  it('subscription-suspended se distingue del 403 comun', () => {
    // No es el usuario el que no puede: es la organizacion. Mandarlo a "pediselo al
    // administrador" lo hace perseguir a alguien que tampoco puede.
    expect(
      traducirErrorAtencion(problema('subscription-suspended', 403, 'Suspendida.')).causa,
    ).toBe('suscripcion-suspendida');
  });

  it('sesion-cerrada explica que corregir una atencion cerrada es una enmienda', () => {
    const traducido = traducirErrorAtencion(problema('sesion-cerrada', 409, 'Cerrada.'));

    expect(traducido.causa).toBe('sesion-cerrada');
    expect(traducido.mensaje).toContain('enmienda');
  });

  it('un 404 no distingue inexistente de ajeno, para no permitir enumerar sedes', () => {
    expect(traducirErrorAtencion(problema('not-found', 404, 'No existe.')).causa).toBe(
      'no-encontrado',
    );
  });

  it('un 409 que no es ninguno de los conocidos queda como conflicto generico', () => {
    expect(traducirErrorAtencion(problema('conflict', 409, 'Conflicto.')).causa).toBe('conflicto');
  });

  it('un 400 sin tipo propio se trata como validacion', () => {
    expect(traducirErrorAtencion(sinCuerpo(400)).causa).toBe('validacion');
  });

  it('un status que nadie previo no se disfraza de otra cosa', () => {
    expect(traducirErrorAtencion(problema('internal-error', 500, 'Boom.')).causa).toBe('otro');
  });

  // -------------------------------------------------------------------------------------
  // El detalle del backend gana, pero solo cuando existe
  // -------------------------------------------------------------------------------------

  it('sin cuerpo se usa el texto fijo en vez de dejar el mensaje vacio', () => {
    // `conDetalle` cae al respaldo solo cuando `problem` es null. Sin esta rama, un rechazo
    // sin ProblemDetail dejaria el panel de error en blanco.
    expect(sinCuerpo(409).problem).toBeNull();
    expect(traducirErrorAtencion(sinCuerpo(409)).mensaje).toContain('Volve a abrir');
    expect(traducirErrorAtencion(sinCuerpo(500)).mensaje).toContain('Volve a intentar');
  });

  it('turno-no-atendible sin motivo utilizable deja el motivo vacio, no "undefined"', () => {
    // La extension puede venir con otro tipo; pintarla igual escribiria "undefined" en pantalla.
    const conMotivoNumerico = new AkineHttpError(
      409,
      {
        type: 'https://akine.app/problems/turno-no-atendible',
        status: 409,
        detail: 'No atendible.',
        properties: { motivo: 42 },
      },
      false,
    );

    expect(traducirErrorAtencion(conMotivoNumerico).motivo).toBe('');
    expect(traducirErrorAtencion(problema('turno-no-atendible', 409, 'No atendible.')).motivo).toBe(
      '',
    );
  });

  function problema(tipo: string, status: number, detail: string): AkineHttpError {
    return new AkineHttpError(
      status,
      { type: `https://akine.app/problems/${tipo}`, status, detail },
      false,
    );
  }

  /** Un rechazo sin ProblemDetail: el backend corto antes de redactar el cuerpo. */
  function sinCuerpo(status: number): AkineHttpError {
    return new AkineHttpError(status, null, false);
  }
});
