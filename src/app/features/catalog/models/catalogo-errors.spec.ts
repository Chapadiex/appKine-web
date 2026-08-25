import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import {
  CausaCatalogo,
  esErrorDelCodigo,
  esErrorDelNombre,
  traducirErrorCatalogo,
} from './catalogo-errors';

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
 * Spec del mapeo de errores del catalogo clinico (M06, AKINE-02.05).
 *
 * <p>Es una <b>tabla</b> por el mismo motivo que la de espacios: el mecanismo es el mismo para
 * los quince y lo que hace falta probar es que <b>ninguno caiga en la rama generica</b>, porque
 * ese fallo es silencioso -un `type` mal escrito da `problemType` nulo, el `switch` cae al
 * `default`, y el usuario recibe "no pudimos completar la operacion" sobre un conflicto que la
 * pantalla sabia explicar-.
 */
describe('traducirErrorCatalogo', () => {
  it('cada problem type llega a su causa propia y ninguno cae en la generica', () => {
    const casos: readonly (readonly [number, string, CausaCatalogo])[] = [
      [403, 'missing-tenant-context', 'sin-contexto'],
      [403, 'forbidden', 'sin-permiso'],
      [400, 'validation-error', 'validacion'],
      [404, 'not-found', 'no-encontrado'],
      [409, 'catalogo-code-taken', 'codigo-tomado'],
      [409, 'catalogo-name-taken', 'nombre-tomado'],
      [409, 'catalogo-inactive', 'concepto-inactivo'],
      [409, 'catalogo-already-inactive', 'ya-inactivo'],
      [409, 'catalogo-reference-inactive', 'referencia-inactiva'],
      [409, 'catalogo-has-active-references', 'con-dependientes'],
      [409, 'catalogo-scope-mismatch', 'alcance-cruzado'],
      [409, 'nomenclador-vigencia-overlap', 'vigencias-solapadas'],
      [409, 'catalogo-solicitud-duplicada', 'solicitud-duplicada'],
      [409, 'catalogo-solicitud-ya-resuelta', 'solicitud-resuelta'],
      [409, 'concurrent-modification', 'concurrencia'],
      [409, 'subscription-suspended', 'suscripcion-suspendida'],
    ];

    for (const [status, tipo, causa] of casos) {
      const traducido = traducirErrorCatalogo(problema(status, tipo));
      expect(traducido.causa, `${tipo} deberia mapear a ${causa}`).toBe(causa);
      expect(traducido.mensaje.length).toBeGreaterThan(0);
      expect(traducido.segundosDeEspera).toBe(0);
    }

    // Los dos conflictos de unicidad aterrizan cada uno en SU campo del formulario.
    expect(esErrorDelNombre('nombre-tomado')).toBe(true);
    expect(esErrorDelCodigo('codigo-tomado')).toBe(true);
    expect(esErrorDelNombre('codigo-tomado')).toBe(false);
    expect(esErrorDelCodigo(null)).toBe(false);
  });

  it('el 403 nombra las DOS causas: falta de permiso y concepto de la plataforma', () => {
    // El backend no las distingue -y no debe: distinguirlas seria decirle a un tenant que el
    // concepto existe y es de otro-. La pantalla si puede nombrarlas, y tiene que hacerlo:
    // la segunda tiene salida y la primera no.
    const mensaje = traducirErrorCatalogo(problema(403, 'forbidden')).mensaje;
    expect(mensaje).toContain('no administras este centro');
    expect(mensaje).toContain('plataforma');
    expect(mensaje).toContain('solicitudes');
  });

  it('falta de contexto no es falta de permiso: manda a elegir consultorio', () => {
    const traducido = traducirErrorCatalogo(problema(403, 'missing-tenant-context'));
    expect(traducido.causa).toBe('sin-contexto');
    expect(traducido.mensaje).toContain('Eligi un consultorio');
  });

  it('los conflictos de unicidad avisan de las dos trampas del filtro', () => {
    // Sin esto el usuario ve "ya existe" sobre algo que no encuentra en su listado: o esta
    // dado de baja -y su codigo se puede reusar-, o es de la plataforma y el filtro por
    // alcance lo esta escondiendo.
    for (const tipo of ['catalogo-code-taken', 'catalogo-name-taken']) {
      const mensaje = traducirErrorCatalogo(problema(409, tipo)).mensaje;
      expect(mensaje).toContain('dado de baja');
      expect(mensaje).toContain('plataforma');
    }
  });

  it('el conflicto de dependientes nombra que hay y cuanto cuando el backend lo manda', () => {
    // La diferencia entre "no se pudo" y "hay 12 practicas colgando" es la diferencia entre
    // llamar a soporte y resolverlo solo.
    const conDatos = traducirErrorCatalogo(
      problema(409, 'catalogo-has-active-references', {
        referenceType: 'practicas',
        referenceCount: 12,
      }),
    );
    expect(conDatos.mensaje).toContain('12 practicas');

    // Y si no los manda, el mensaje sigue siendo accionable en vez de romperse.
    const sinDatos = traducirErrorCatalogo(problema(409, 'catalogo-has-active-references'));
    expect(sinDatos.causa).toBe('con-dependientes');
    expect(sinDatos.mensaje).toContain('dependen de el');
  });

  it('el 429 usa el plazo del backend y no inventa uno cuando no lo hay', () => {
    const conPlazo = new AkineHttpError(429, { detail: 'esperá' }, false, 7);
    const traducido = traducirErrorCatalogo(conPlazo);
    expect(traducido.causa).toBe('limite');
    expect(traducido.segundosDeEspera).toBe(7);
    expect(traducido.mensaje).toContain('7 segundos');

    const sinPlazo = new AkineHttpError(429, { detail: 'esperá' }, false);
    const generico = traducirErrorCatalogo(sinPlazo);
    expect(generico.segundosDeEspera).toBe(0);
    expect(generico.mensaje).not.toMatch(/\d+ segundos/);
  });

  it('lo que no es un error del cliente HTTP no explota: cae en la rama generica', () => {
    expect(traducirErrorCatalogo(new Error('cualquier cosa')).causa).toBe('otro');
    expect(traducirErrorCatalogo(null).causa).toBe('otro');

    // Y un fallo de red se distingue: no hay nada que reintentar del lado del servidor.
    const red = new AkineHttpError(0, null, true);
    expect(traducirErrorCatalogo(red).causa).toBe('red');
  });
});
