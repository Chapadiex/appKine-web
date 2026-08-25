import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import {
  CausaInvitacion,
  seResuelveReenviando,
  traducirErrorInvitacion,
} from './invitacion-errors';

/** Arma el error tal como lo entrega `errorInterceptor`, con el `type` completo. */
function problema(status: number, tipo: string | null) {
  return new AkineHttpError(
    status,
    {
      ...(tipo === null ? {} : { type: `https://akine.app/problems/${tipo}` }),
      detail: 'prosa del backend',
      properties: {},
    },
    false,
  );
}

/**
 * Spec del mapeo de errores de invitaciones (M05, AKINE-02.03).
 *
 * <p>Es una tabla por el mismo motivo que las otras dos del repo: lo que hace falta probar es que
 * <b>ninguno caiga en la rama generica</b>, porque ese fallo es silencioso —un `type` mal escrito
 * da `problemType` nulo, el `switch` cae al `default`, y el usuario recibe "no pudimos completar
 * la operacion" sobre un conflicto que la pantalla sabia explicar—.
 */
describe('traducirErrorInvitacion', () => {
  it('cada problem type llega a su causa propia y ninguno cae en la generica', () => {
    const casos: readonly (readonly [number, string, CausaInvitacion])[] = [
      [403, 'missing-tenant-context', 'sin-contexto'],
      [403, 'forbidden', 'sin-permiso'],
      [400, 'validation-error', 'validacion'],
      [404, 'not-found', 'no-encontrado'],
      [409, 'invitacion-pendiente-duplicada', 'pendiente-duplicada'],
      [409, 'invitacion-vencida', 'vencida'],
      [409, 'invitacion-ya-resuelta', 'ya-resuelta'],
      [409, 'colaborador-ya-vinculado', 'ya-vinculado'],
      [409, 'plan-limit-exceeded', 'tope-de-plan'],
      [409, 'subscription-suspended', 'suscripcion-suspendida'],
    ];

    for (const [status, tipo, causa] of casos) {
      const traducido = traducirErrorInvitacion(problema(status, tipo));
      expect(traducido.causa, `${tipo} deberia mapear a ${causa}`).toBe(causa);
      expect(traducido.mensaje.length).toBeGreaterThan(0);
      expect(traducido.segundosDeEspera).toBe(0);
    }
  });

  it('vencida y duplicada comparten salida, y el resto no', () => {
    // Los dos casos que se resuelven reenviando la invitacion que ya existe. Aparecen en
    // pantallas distintas —el administrador ve el duplicado, el invitado ve el vencimiento— y
    // por eso la funcion existe: las dos pantallas preguntan lo mismo.
    expect(seResuelveReenviando('vencida')).toBe(true);
    expect(seResuelveReenviando('pendiente-duplicada')).toBe(true);
    expect(seResuelveReenviando('ya-vinculado')).toBe(false);
    expect(seResuelveReenviando(null)).toBe(false);
  });

  it('el enlace vencido dice que la invitacion sigue en pie, no que no existe', () => {
    // Es el unico caso donde el backend responde 409 en vez del 404 uniforme, y el texto tiene
    // que aprovecharlo: confundirlo con "no existe" manda al invitado a reportar una falla
    // cuando lo unico que necesita es pedir un reenvio.
    const mensaje = traducirErrorInvitacion(problema(409, 'invitacion-vencida')).mensaje;
    expect(mensaje).toContain('reenvie');
    expect(mensaje).not.toContain('no existe');
  });

  it('el tope de plan explica por que aparece recien al aceptar', () => {
    // Sin esa explicacion, "llegaste al tope" sobre una invitacion que se emitio sin problemas
    // parece un bug: emitir no consume cupo justamente para que nadie se quede sin lugares
    // invitando a gente que no responde.
    const mensaje = traducirErrorInvitacion(problema(409, 'plan-limit-exceeded')).mensaje;
    expect(mensaje).toContain('Emitir invitaciones no consume lugares');
  });

  it('falta de contexto no es falta de permiso: manda a elegir consultorio', () => {
    const traducido = traducirErrorInvitacion(problema(403, 'missing-tenant-context'));
    expect(traducido.causa).toBe('sin-contexto');
    expect(traducido.mensaje).toContain('Eligi un consultorio');
  });

  it('el 429 usa el plazo del backend y no inventa uno cuando no lo hay', () => {
    const conPlazo = new AkineHttpError(429, { detail: 'espera' }, false, 12);
    const traducido = traducirErrorInvitacion(conPlazo);
    expect(traducido.causa).toBe('limite');
    expect(traducido.segundosDeEspera).toBe(12);
    expect(traducido.mensaje).toContain('12 segundos');

    const sinPlazo = new AkineHttpError(429, { detail: 'espera' }, false);
    expect(traducirErrorInvitacion(sinPlazo).segundosDeEspera).toBe(0);
  });

  it('lo que no es un error del cliente HTTP no explota', () => {
    expect(traducirErrorInvitacion(new Error('cualquier cosa')).causa).toBe('otro');
    expect(traducirErrorInvitacion(null).causa).toBe('otro');
    expect(traducirErrorInvitacion(new AkineHttpError(0, null, true)).causa).toBe('red');
  });
});
