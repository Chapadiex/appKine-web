import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { CausaEspacio, esErrorDelNombre, traducirErrorEspacio } from './espacio-errors';

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
 * Spec del mapeo de errores de espacios (M04, AKINE-02.02).
 *
 * <p>Es una <b>tabla</b> y no un `it` por codigo a proposito: el mecanismo es el mismo para los
 * doce y repetirlo doce veces no prueba nada nuevo. Lo que si hace falta probar es que ninguno
 * caiga en la rama generica, porque ese fallo es <b>silencioso</b>: un `type` mal escrito hace
 * que `problemType` devuelva `null`, el `switch` cae al `default`, y el usuario recibe "no
 * pudimos completar la operacion" sobre un conflicto que la pantalla sabia explicar.
 */
describe('traducirErrorEspacio', () => {
  it('cada problem type llega a su causa propia y ninguno cae en la generica', () => {
    const casos: readonly (readonly [number, string, CausaEspacio])[] = [
      [403, 'missing-tenant-context', 'sin-contexto'],
      [403, 'forbidden', 'sin-permiso'],
      [400, 'validation-error', 'validacion'],
      [404, 'not-found', 'no-encontrado'],
      [409, 'espacio-name-taken', 'nombre-tomado'],
      [409, 'espacio-inactive', 'espacio-inactivo'],
      [409, 'espacio-already-inactive', 'ya-inactivo'],
      [409, 'concurrent-modification', 'concurrencia'],
      [409, 'consultorio-inactive', 'sede-inactiva'],
      [409, 'espacio-capacity-below-occupancy', 'capacidad-comprometida'],
      [409, 'espacio-has-active-references', 'con-referencias'],
      [409, 'subscription-suspended', 'suscripcion-suspendida'],
    ];

    for (const [status, tipo, causa] of casos) {
      const traducido = traducirErrorEspacio(problema(status, tipo));
      expect(traducido.causa, `${tipo} deberia mapear a ${causa}`).toBe(causa);
      expect(traducido.mensaje.length).toBeGreaterThan(0);
      expect(traducido.segundosDeEspera).toBe(0);
    }

    // Solo el conflicto de nombre aterriza en un campo del formulario.
    expect(esErrorDelNombre('nombre-tomado')).toBe(true);
    expect(esErrorDelNombre('concurrencia')).toBe(false);
    expect(esErrorDelNombre(null)).toBe(false);
  });

  it('falta de contexto no es falta de permiso: manda a elegir sede, nunca al login', () => {
    // Los dos son 403 y tienen salidas opuestas. Tratarlos igual manda a re-autenticarse a
    // alguien cuyas credenciales estan bien: volveria a entrar y le faltaria lo mismo.
    expect(traducirErrorEspacio(problema(403, 'missing-tenant-context')).mensaje).toContain(
      'Eligi un consultorio',
    );
    expect(traducirErrorEspacio(problema(403, 'forbidden')).mensaje).toContain('No tenes permiso');
  });

  it('el conflicto de nombre aclara que el de un espacio dado de baja si se puede reusar', () => {
    // El backend no puede saber que esto hace falta decirlo. Sin la aclaracion, quien acaba de
    // dar de baja "Box 2" lee "ya existe", no lo ve en su listado filtrado por activos y
    // concluye que la pantalla esta rota.
    expect(traducirErrorEspacio(problema(409, 'espacio-name-taken')).mensaje).toContain(
      'SI se puede reusar',
    );
  });

  it('los dos codigos reservados usan sus extras cuando llegan, y degradan cuando no', () => {
    // Ninguno de los dos se emite hoy: la ocupacion es siempre cero y no hay agenda. El dia que
    // empiecen a llegar tienen que encontrar un mensaje util, no la rama generica.
    const conNumeros = traducirErrorEspacio(
      problema(409, 'espacio-capacity-below-occupancy', {
        requestedCapacity: 1,
        currentOccupancy: 3,
        occupancyType: 'turnos futuros',
      }),
    );
    expect(conNumeros.mensaje).toContain('bajar la capacidad a 1');
    expect(conNumeros.mensaje).toContain('3 lugares');
    expect(conNumeros.mensaje).toContain('turnos futuros');

    const conReferencias = traducirErrorEspacio(
      problema(409, 'espacio-has-active-references', {
        referenceType: 'turnos futuros',
        referenceCount: 14,
      }),
    );
    expect(conReferencias.mensaje).toContain('14 turnos futuros');

    // Sin los extras el mensaje sigue siendo accionable, solo que sin numeros.
    expect(
      traducirErrorEspacio(problema(409, 'espacio-capacity-below-occupancy')).mensaje,
    ).toContain('mas lugares comprometidos');
    expect(traducirErrorEspacio(problema(409, 'espacio-has-active-references')).mensaje).toContain(
      'operaciones vigentes',
    );
  });

  it('red, limite y lo desconocido tienen cada uno su salida', () => {
    const red = traducirErrorEspacio(new AkineHttpError(0, null, true));
    expect(red.causa).toBe('red');
    expect(red.mensaje).toContain('conexion');

    // Con `Retry-After` se dice el plazo; sin el NO se inventa uno, porque un numero inventado
    // deja esperando de mas o promete que ya se puede y se come otro 429.
    const conPlazo = traducirErrorEspacio(new AkineHttpError(429, null, false, 12));
    expect(conPlazo.causa).toBe('limite');
    expect(conPlazo.segundosDeEspera).toBe(12);
    expect(conPlazo.mensaje).toContain('12 segundos');

    const sinPlazo = traducirErrorEspacio(new AkineHttpError(429, null, false, null));
    expect(sinPlazo.segundosDeEspera).toBe(0);
    expect(sinPlazo.mensaje).not.toMatch(/\d+ segundos/);

    // Un 500 sin cuerpo, y algo que ni siquiera es un error HTTP: los dos degradan al generico
    // en vez de romper la pantalla.
    expect(traducirErrorEspacio(new AkineHttpError(500, null, false)).causa).toBe('otro');
    expect(traducirErrorEspacio(problema(500, null)).causa).toBe('otro');
    expect(traducirErrorEspacio('no soy un error').causa).toBe('otro');
  });
});
