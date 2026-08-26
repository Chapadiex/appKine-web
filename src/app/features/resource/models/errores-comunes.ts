import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * La <b>mecanica</b> compartida por los tres traductores de errores de horarios (M05,
 * AKINE-02.04).
 *
 * <p><b>Que entra aca y que no.</b> `bloque-errors.ts`, `excepcion-errors.ts` y
 * `horario-efectivo-errors.ts` redactan mensajes distintos <b>a proposito</b>: cada pantalla
 * nombra lo que se esta tocando, y un 404 que dice "ese bloque ya no existe" en la pantalla de
 * excepciones manda a buscar al lugar equivocado. Esas divergencias son la razon de que los tres
 * archivos existan y no se tocan.
 *
 * <p>Lo que si eran tres copias identicas, letra por letra, son las tres funciones de abajo: leer
 * el `detail` del backend o caer al respaldo, y normalizar el `Retry-After`. Tres copias de la
 * misma regla se despegan sola el dia que alguien arregle una: el bug queda en las otras dos y
 * nadie lo ve, porque los tests de cada traductor siguen verdes.
 */

/** La parte del error traducido que los tres comparten con la misma forma. */
export interface MensajeTraducido<C> {
  readonly mensaje: string;
  readonly causa: C;
  /** Segundos a esperar antes de reintentar. 0 fuera de `limite`. */
  readonly segundosDeEspera: number;
}

/**
 * El nucleo de un error traducido, sin las extensiones propias de cada traductor.
 *
 * <p>Cada traductor lo envuelve con lo suyo —`conflicto` en bloques, `maximoDias` donde hay
 * ventana— en su propio `base()`, que sigue siendo privado.
 */
export function mensajeTraducido<C>(mensaje: string, causa: C): MensajeTraducido<C> {
  return { mensaje, causa, segundosDeEspera: 0 };
}

/** El mensaje del backend, o el de respaldo si el cuerpo no traia `ProblemDetail`. */
export function conDetalle(error: AkineHttpError, respaldo: string): string {
  return error.problem === null ? respaldo : error.message;
}

/** Espera declarada en `Retry-After`, o `0`. Sin header no se inventa un numero. */
export function segundosDeEspera(error: AkineHttpError): number {
  const segundos = error.reintentarEnSegundos;
  if (segundos === null || !Number.isFinite(segundos) || segundos <= 0) {
    return 0;
  }
  return Math.ceil(segundos);
}
