import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import {
  AmbitoContracting,
  CausaContracting,
  hayQueRecargar,
  traducirErrorContracting,
} from './contracting-errors';

/** Arma el error tal como lo entrega `errorInterceptor`, con el `type` completo. */
function problema(status: number, tipo: string | null, reintentarEnSegundos: number | null = null) {
  return new AkineHttpError(
    status,
    {
      ...(tipo === null ? {} : { type: `https://akine.app/problems/${tipo}` }),
      detail: 'prosa del backend',
      properties: {},
    },
    false,
    reintentarEnSegundos,
  );
}

/**
 * Spec del mapeo de errores de contratacion (M15 y M16, AKINE-03.03 y 03.05).
 *
 * <p>Es una <b>tabla</b>, por lo mismo que la de `offering` y la del catalogo clinico: lo que hace
 * falta probar es que ninguna respuesta caiga en la rama generica, porque ese fallo es
 * <b>silencioso</b>. Un `type` mal escrito da `problemType` nulo, el `switch` cae al `default`, y
 * el usuario recibe "no pudimos completar la operacion" sobre un conflicto que la pantalla sabia
 * explicar. Once tipos propios es demasiada superficie para confiar en la lectura.
 */
describe('traducirErrorContracting', () => {
  it('cada respuesta llega a su causa propia y ninguna cae en la generica por error', () => {
    const casos: readonly (readonly [number, string | null, AmbitoContracting, CausaContracting])[] =
      [
        [403, 'missing-tenant-context', 'convenio', 'sin-contexto'],
        [409, 'subscription-suspended', 'financiador', 'suscripcion-suspendida'],
        [409, 'conflict', 'financiador', 'concurrencia'],
        // `concurrent-modification` no lo emite `contracting` hoy —la version vieja sale como
        // `conflict`—. Se reconoce igual, y esto lo fija: si algun dia se unifican los dos tipos
        // en todos los modulos, estas pantallas no se enteran.
        [409, 'concurrent-modification', 'convenio', 'concurrencia'],
        [400, 'validation-error', 'arancel', 'validacion'],

        [409, 'financiador-codigo-taken', 'financiador', 'codigo-repetido'],
        [409, 'plan-cobertura-codigo-taken', 'plan', 'codigo-repetido'],
        [409, 'convenio-codigo-taken', 'convenio', 'codigo-repetido'],
        [409, 'financiador-nombre-taken', 'financiador', 'nombre-repetido'],
        [409, 'plan-cobertura-nombre-taken', 'plan', 'nombre-repetido'],
        [409, 'financiador-cuit-taken', 'financiador', 'cuit-repetido'],

        // Los dos solapamientos van a la MISMA causa: la salida es la misma —cerrar la vigencia
        // del que ya esta— y separarlos daria dos mensajes que dicen lo mismo con otras palabras.
        [409, 'convenio-solapado', 'convenio', 'solapamiento'],
        [409, 'arancel-solapado', 'arancel', 'solapamiento'],

        [409, 'financiador-inactivo', 'plan', 'referencia-inactiva'],
        [409, 'plan-cobertura-inactivo', 'convenio', 'referencia-inactiva'],
        [409, 'convenio-inactivo', 'arancel', 'referencia-inactiva'],
        [409, 'arancel-inactivo', 'arancel', 'referencia-inactiva'],

        [409, 'financiador-already-inactive', 'financiador', 'ya-dada-de-baja'],
        [409, 'plan-cobertura-already-inactive', 'plan', 'ya-dada-de-baja'],
        [409, 'convenio-already-inactive', 'convenio', 'ya-dada-de-baja'],
        [409, 'arancel-already-inactive', 'arancel', 'ya-dada-de-baja'],

        [403, 'forbidden', 'convenio', 'sin-permiso'],
        [404, 'not-found', 'financiador', 'no-encontrado'],
        [500, null, 'financiador', 'otro'],
      ];

    for (const [status, tipo, ambito, esperada] of casos) {
      expect(traducirErrorContracting(problema(status, tipo), ambito).causa).toBe(esperada);
    }
  });

  it('el ambito solo cambia a donde manda el 404, que es lo unico distinto entre las cuatro', () => {
    const mensajes = (['financiador', 'plan', 'convenio', 'arancel'] as const).map(
      (ambito) => traducirErrorContracting(problema(404, 'not-found'), ambito).mensaje,
    );

    expect(mensajes[0]).toContain('catalogo');
    expect(mensajes[1]).toContain('planes del financiador');
    expect(mensajes[2]).toContain('no es de esta sede');
    expect(mensajes[3]).toContain('grilla del convenio');
    expect(new Set(mensajes).size).toBe(4);

    // Y el resto NO cambia con el ambito: si cambiara, harian falta cuatro traductores.
    const permiso = (['financiador', 'convenio'] as const).map(
      (ambito) => traducirErrorContracting(problema(403, 'forbidden'), ambito).mensaje,
    );
    expect(permiso[0]).toBe(permiso[1]);
  });

  it('el solapamiento ensena a cerrar la vigencia, que no es dar de baja', () => {
    // Es el unico mensaje que manda a hacer OTRA operacion: recargar no lo arregla, porque el
    // periodo que choca sigue estando ahi. Si el texto se pierde, renovar un convenio parece
    // imposible y el usuario da de baja el anterior, que es lo que RN-M16-003 no quiere.
    const traducido = traducirErrorContracting(problema(409, 'convenio-solapado'), 'convenio');
    expect(traducido.mensaje).toContain('cerra la vigencia del que ya esta');
    expect(traducido.mensaje).toContain('no es lo mismo que darlo de baja');
    expect(hayQueRecargar(traducido.causa)).toBe(false);
  });

  it('el codigo repetido aclara que el de una ficha dada de baja si se puede reusar', () => {
    // Sin esa mitad, quien acaba de dar de baja un financiador y quiere volver a cargarlo con el
    // mismo codigo lee "ya existe" y concluye que el sistema no lo dejo darlo de baja.
    expect(
      traducirErrorContracting(problema(409, 'financiador-codigo-taken'), 'financiador').mensaje,
    ).toContain('ficha dada de baja si se puede reusar');
  });

  it('la referencia inactiva explica que la baja no cascadea', () => {
    // El backend manda `financiador-inactivo` con su propio detail, y ese gana. Lo que se fija
    // aca es la causa: la pantalla tiene que poder distinguirla de un conflicto cualquiera.
    const traducido = traducirErrorContracting(problema(409, 'financiador-inactivo'), 'plan');
    expect(traducido.causa).toBe('referencia-inactiva');
    expect(traducido.mensaje).toBe('prosa del backend');
  });

  it('un 429 con Retry-After dice cuantos segundos, y sin el no inventa un numero', () => {
    const conPlazo = traducirErrorContracting(problema(429, 'rate-limited', 12), 'financiador');
    expect(conPlazo.causa).toBe('limite');
    expect(conPlazo.segundosDeEspera).toBe(12);
    expect(conPlazo.mensaje).toContain('12 segundos');

    const sinPlazo = traducirErrorContracting(problema(429, 'rate-limited'), 'financiador');
    expect(sinPlazo.segundosDeEspera).toBe(0);
    expect(sinPlazo.mensaje).not.toContain('0 segundos');
  });

  it('un error de red no se confunde con un rechazo del servidor', () => {
    const traducido = traducirErrorContracting(new AkineHttpError(0, null, true), 'convenio');
    expect(traducido.causa).toBe('red');
    expect(traducido.mensaje).toContain('Revisa tu conexion');
  });

  it('lo que no es un AkineHttpError cae en el generico sin romper', () => {
    expect(traducirErrorContracting(new Error('cualquier cosa'), 'arancel').causa).toBe('otro');
  });

  it('solo se ofrece recargar donde recargar sirve para algo', () => {
    expect(hayQueRecargar('no-encontrado')).toBe(true);
    expect(hayQueRecargar('conflicto')).toBe(true);
    expect(hayQueRecargar('ya-dada-de-baja')).toBe(true);
    // Estas tres se resuelven en el formulario o pidiendo acceso, no releyendo el listado.
    expect(hayQueRecargar('solapamiento')).toBe(false);
    expect(hayQueRecargar('sin-permiso')).toBe(false);
    expect(hayQueRecargar('codigo-repetido')).toBe(false);
    expect(hayQueRecargar(null)).toBe(false);
  });
});
