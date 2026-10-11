import { vi } from 'vitest';

/**
 * Reloj fijo para los specs que dependen de "hoy".
 *
 * <p>Solo se falsifica `Date`: los temporizadores siguen reales, asi que `whenStable` y las
 * esperas de Angular no cambian. Con `navegadorEnUtc` el navegador simulado esta en UTC sin
 * importar la zona de la maquina que corre los tests —la del CI es UTC y la de desarrollo
 * Cordoba—: el dia "del navegador" (`getTimezoneOffset`) sale entonces del instante en UTC.
 *
 * <p>Por que hace falta: a las 00:25 UTC del 10/10 en Cordoba todavia son las 21:25 del 09/10. Un
 * spec sin reloj fijo pasa o falla segun la hora a la que se corre, que es justamente el defecto
 * que se esta probando.
 *
 * <p>Se deshace con {@link soltarReloj} en el `afterEach`.
 */
export function fijarReloj(instante: string, opciones: { navegadorEnUtc?: boolean } = {}): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instante));
  if (opciones.navegadorEnUtc === true) {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0);
  }
}

export function soltarReloj(): void {
  vi.useRealTimers();
  vi.restoreAllMocks();
}
