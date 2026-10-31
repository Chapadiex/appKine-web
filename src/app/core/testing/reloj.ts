import { vi } from 'vitest';

/** El `process.env` de Node que corre los specs; el tsconfig de specs no trae los tipos de Node. */
const entorno = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process.env;

/**
 * Zona del proceso antes de que un spec la cambiara, para devolverla en {@link soltarReloj}.
 *
 * <p>Se guarda la zona efectiva y no el valor de `TZ`: en Windows, borrar `TZ` no vuelve a la zona del
 * sistema, se queda en la ultima que se le dio. Con los workers sin aislar eso dejaba al resto de los
 * specs de ese worker en otro huso, y fallaba uno distinto segun el orden en que tocaran.
 */
let zonaOriginal: string | null = null;

/**
 * Reloj fijo para los specs que dependen de "hoy".
 *
 * <p>Solo se falsifica `Date`: los temporizadores siguen reales, asi que `whenStable` y las
 * esperas de Angular no cambian. Con `navegadorEnUtc` el navegador simulado esta en UTC sin
 * importar la zona de la maquina que corre los tests —la del CI es UTC y la de desarrollo
 * Cordoba—: el dia "del navegador" (`getTimezoneOffset`) sale entonces del instante en UTC.
 *
 * <p>Con `zonaDelNavegador` se cambia la zona del PROCESO (`process.env.TZ`), que Node aplica en
 * caliente a `Date` y a `Intl`: el formateo sin zona explicita sale en esa zona, igual que en un
 * navegador que corre en otro huso. Es lo que prueba que una pantalla formatea en la zona de la
 * sede y no en la del navegador, sea cual sea la maquina que corre el spec.
 *
 * <p>Por que hace falta: a las 00:25 UTC del 10/10 en Cordoba todavia son las 21:25 del 09/10. Un
 * spec sin reloj fijo pasa o falla segun la hora a la que se corre, que es justamente el defecto
 * que se esta probando.
 *
 * <p>Se deshace con {@link soltarReloj} en el `afterEach`.
 */
export function fijarReloj(
  instante: string,
  opciones: { navegadorEnUtc?: boolean; zonaDelNavegador?: string } = {},
): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instante));
  if (opciones.navegadorEnUtc === true) {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0);
  }
  if (opciones.zonaDelNavegador !== undefined) {
    if (zonaOriginal === null) {
      zonaOriginal = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    entorno['TZ'] = opciones.zonaDelNavegador;
  }
}

export function soltarReloj(): void {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (zonaOriginal !== null) {
    entorno['TZ'] = zonaOriginal;
    zonaOriginal = null;
  }
}
