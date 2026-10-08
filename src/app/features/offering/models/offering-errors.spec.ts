import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import {
  AmbitoOffering,
  CausaOffering,
  hayQueRecargar,
  traducirErrorOffering,
} from './offering-errors';

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
 * Spec del mapeo de errores de servicios y ofertas (M27, AKINE-02.06).
 *
 * <p>Es una <b>tabla</b>, por lo mismo que la del catalogo clinico: lo que hace falta probar es
 * que ninguna respuesta caiga en la rama generica, porque ese fallo es silencioso —un `type` mal
 * escrito da `problemType` nulo, el `switch` cae al `default`, y el usuario recibe "no pudimos
 * completar la operacion" sobre un conflicto que la pantalla sabia explicar—.
 */
describe('traducirErrorOffering', () => {
  it('cada respuesta llega a su causa propia y ninguna cae en la generica por error', () => {
    const casos: readonly (readonly [number, string | null, AmbitoOffering, CausaOffering])[] = [
      [403, 'missing-tenant-context', 'oferta', 'sin-contexto'],
      [403, 'missing-tenant-context', 'servicio', 'sin-contexto'],
      [409, 'subscription-suspended', 'oferta', 'suscripcion-suspendida'],
      [409, 'conflict', 'oferta', 'concurrencia'],
      // `concurrent-modification` no lo emite `offering` hoy. Se reconoce igual, y esto lo fija:
      // si algun dia se unifican los dos tipos, esta pantalla no se entera.
      [409, 'concurrent-modification', 'oferta', 'concurrencia'],
      [400, 'validation-error', 'oferta', 'validacion'],
      [409, 'oferta-nombre-comercial-taken', 'oferta', 'conflicto'],
      [409, 'servicio-inactivo', 'oferta', 'conflicto'],
      [409, 'servicio-codigo-taken', 'servicio', 'conflicto'],
      [409, 'precio-particular-solapado', 'oferta', 'precio-solapado'],
      [409, 'precio-particular-inactivo', 'oferta', 'precio-inactivo'],
      [409, 'practica-no-utilizable', 'oferta', 'practica-no-utilizable'],
      [409, 'oferta-inactiva', 'oferta', 'oferta-inactiva'],
      [409, 'consultorio-no-operable', 'oferta', 'consultorio-no-operable'],
      [500, null, 'oferta', 'otro'],
    ];

    for (const [status, tipo, ambito, esperada] of casos) {
      expect(traducirErrorOffering(problema(status, tipo), ambito).causa).toBe(esperada);
    }
  });

  it('el ambito cambia el 403 y el 404, y nada mas', () => {
    // Es la unica diferencia entre las dos pantallas, y por eso hay un solo traductor.
    expect(traducirErrorOffering(problema(403, 'forbidden'), 'servicio').causa).toBe(
      'sin-rol-de-plataforma',
    );
    expect(traducirErrorOffering(problema(403, 'forbidden'), 'oferta').causa).toBe('sin-permiso');

    const servicioNoEncontrado = traducirErrorOffering(problema(404, 'not-found'), 'servicio');
    const ofertaNoEncontrada = traducirErrorOffering(problema(404, 'not-found'), 'oferta');
    expect(servicioNoEncontrado.causa).toBe('no-encontrado');
    expect(ofertaNoEncontrada.causa).toBe('no-encontrado');
    expect(servicioNoEncontrado.mensaje).not.toBe(ofertaNoEncontrada.mensaje);
  });

  it('el 403 del catalogo global explica que se puede seguir leyendo', () => {
    // Sostiene la decision de la pantalla: las acciones se muestran y el rechazo lo da el
    // servidor, porque hoy ningun endpoint dice si quien mira tiene rol de plataforma. Si el
    // mensaje no explicara eso, el usuario leeria el 403 como un error suyo.
    const { mensaje } = traducirErrorOffering(problema(403, 'forbidden'), 'servicio');
    expect(mensaje).toContain('rol de plataforma');
    expect(mensaje).toContain('ofertas');
  });

  it('el detail del backend gana en validacion y en los 409 sin tipo propio', () => {
    expect(traducirErrorOffering(problema(400, 'validation-error'), 'oferta').mensaje).toBe(
      'prosa del backend',
    );
    expect(
      traducirErrorOffering(problema(409, 'oferta-nombre-comercial-taken'), 'oferta').mensaje,
    ).toBe('prosa del backend');
  });

  it('sin cuerpo de ProblemDetail cae al mensaje de respaldo y no muestra vacio', () => {
    const sinCuerpo = new AkineHttpError(409, null, false);
    expect(traducirErrorOffering(sinCuerpo, 'oferta').mensaje).toContain('conflicto');
  });

  it('un error que no es de la API no se interpreta: mensaje generico', () => {
    expect(traducirErrorOffering(new Error('cualquier cosa'), 'oferta').causa).toBe('otro');
    expect(traducirErrorOffering(null, 'servicio').causa).toBe('otro');
  });

  it('el fallo de red se distingue del error del servidor', () => {
    const red = new AkineHttpError(0, null, true);
    const traducido = traducirErrorOffering(red, 'oferta');
    expect(traducido.causa).toBe('red');
    expect(traducido.mensaje).toContain('conexion');
  });

  it('el 429 dice cuantos segundos esperar solo cuando el servidor los declaro', () => {
    // Sin `Retry-After` no se inventa un numero: un plazo inventado que vence antes hace que el
    // usuario reintente y coma otro 429.
    const conPlazo = new AkineHttpError(
      429,
      { type: 'https://akine.app/problems/rate-limited', detail: 'x', properties: {} },
      false,
      12.2,
    );
    const traducidoConPlazo = traducirErrorOffering(conPlazo, 'oferta');
    expect(traducidoConPlazo.causa).toBe('limite');
    expect(traducidoConPlazo.segundosDeEspera).toBe(13);
    expect(traducidoConPlazo.mensaje).toContain('13');

    const sinPlazo = new AkineHttpError(
      429,
      { type: 'https://akine.app/problems/rate-limited', detail: 'x', properties: {} },
      false,
      null,
    );
    const traducidoSinPlazo = traducirErrorOffering(sinPlazo, 'oferta');
    expect(traducidoSinPlazo.segundosDeEspera).toBe(0);
    expect(traducidoSinPlazo.mensaje).not.toContain('0 segundos');
  });

  it('todas las causas traen segundosDeEspera en 0 fuera del limite', () => {
    expect(traducirErrorOffering(problema(404, 'not-found'), 'oferta').segundosDeEspera).toBe(0);
  });
});

describe('hayQueRecargar', () => {
  it('solo pide recargar donde releer es lo unico que resuelve', () => {
    expect(hayQueRecargar('no-encontrado')).toBe(true);
    expect(hayQueRecargar('conflicto')).toBe(true);

    // La concurrencia NO esta: esa pantalla ya releyo sola y dejo el panel abierto. Pedirle al
    // usuario que recargue encima le borraria lo que estaba por confirmar.
    expect(hayQueRecargar('concurrencia')).toBe(false);
    expect(hayQueRecargar('sin-permiso')).toBe(false);
    expect(hayQueRecargar('sin-contexto')).toBe(false);
    expect(hayQueRecargar(null)).toBe(false);
  });
});
