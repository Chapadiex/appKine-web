/**
 * Zonas horarias ofrecidas al elegir la zona de una sede (M01, AKINE-02.01).
 *
 * <p><b>Por que un selector y no un campo de texto.</b> El backend solo acepta
 * identificadores IANA (`America/Argentina/Cordoba`). Un offset fijo como `-03:00` lo
 * rechaza con `400`, y con razon: un offset no conoce el horario de verano, asi que una
 * agenda armada sobre el se correria una hora el dia que la regla cambie. Con un `select`
 * el caso directamente no se puede construir desde la interfaz.
 *
 * <p><b>El grupo mundial sale del motor.</b> `Intl.supportedValuesOf('timeZone')` devuelve
 * la base IANA del propio navegador, que es la misma que valida el backend con `ZoneId`.
 * Escribir a mano las 400 zonas del mundo garantizaba quedar desactualizado y ofrecer
 * identificadores que el servidor no conoce.
 *
 * <p><b>El grupo argentino NO sale del motor, y es a proposito.</b> `supportedValuesOf`
 * devuelve solo identificadores <b>canonicos</b>, y cual es el canonico depende de la
 * version de ICU: en Node 24 la lista trae `America/Cordoba` y `America/Buenos_Aires` —los
 * alias viejos— en lugar de `America/Argentina/Cordoba` y `America/Argentina/Buenos_Aires`,
 * mientras que para Salta o Ushuaia si devuelve la forma larga. Filtrar por el prefijo
 * `America/Argentina/` mandaba las dos zonas mas usadas del pais al fondo del grupo "resto
 * del mundo", justo las que elige casi todo el padron de clientes. Por eso el grupo
 * argentino es una lista propia, corta, estable y de nombres que `ZoneId` acepta en
 * cualquier version; el motor solo aporta el resto.
 *
 * <p><b>Respaldo.</b> `Intl.supportedValuesOf` es relativamente reciente; si no existe, el
 * segundo grupo queda vacio y el argentino sigue estando. Un alta de sede que no se puede
 * completar es peor que una lista corta.
 */

/** Prefijo de las zonas argentinas en su forma larga. */
const PREFIJO_ARGENTINA = 'America/Argentina/';

/**
 * Zonas del pais donde se usa el producto, en su forma larga.
 *
 * <p>Son las 12 zonas argentinas de la tzdb. Se ofrecen siempre, vengan o no en la lista del
 * motor: ver la nota de canonicalizacion arriba.
 */
const ZONAS_ARGENTINAS = [
  'America/Argentina/Buenos_Aires',
  'America/Argentina/Catamarca',
  'America/Argentina/Cordoba',
  'America/Argentina/Jujuy',
  'America/Argentina/La_Rioja',
  'America/Argentina/Mendoza',
  'America/Argentina/Rio_Gallegos',
  'America/Argentina/Salta',
  'America/Argentina/San_Juan',
  'America/Argentina/San_Luis',
  'America/Argentina/Tucuman',
  'America/Argentina/Ushuaia',
] as const;

/** Las zonas, separadas en los dos grupos que muestra el `select`. */
export interface ZonasHorarias {
  readonly argentinas: readonly string[];
  readonly resto: readonly string[];
}

/**
 * Etiqueta legible de una zona IANA.
 *
 * <p>`America/Argentina/Rio_Gallegos` -&gt; `Rio Gallegos`. Se muestra el ultimo segmento
 * porque el prefijo ya lo dice el nombre del grupo, y los guiones bajos son ruido de
 * formato, no parte del nombre de la ciudad. El `value` del `option` sigue siendo el
 * identificador completo: lo que viaja al backend nunca es esta etiqueta.
 */
export function etiquetaDeZona(zona: string): string {
  return (zona.split('/').pop() ?? zona).replace(/_/g, ' ');
}

/** Las zonas disponibles, calculadas una sola vez por carga de la aplicacion. */
export function zonasHorarias(): ZonasHorarias {
  cache ??= calcular();
  return cache;
}

let cache: ZonasHorarias | null = null;

/**
 * Nombres de las ciudades argentinas, para descartar del grupo mundial sus alias viejos.
 *
 * <p>Sin esto, `America/Cordoba` aparece en "resto del mundo" al lado de
 * `America/Argentina/Cordoba` en "Argentina": dos opciones para la misma zona, que llevan a
 * dos sedes de la misma ciudad guardadas con identificadores distintos.
 */
const CIUDADES_ARGENTINAS: ReadonlySet<string> = new Set(
  ZONAS_ARGENTINAS.map((zona) => zona.slice(PREFIJO_ARGENTINA.length)),
);

function calcular(): ZonasHorarias {
  const argentinas = [...ZONAS_ARGENTINAS];
  const todas = zonasDelMotor();
  if (todas === null) {
    return { argentinas, resto: [] };
  }

  return { argentinas, resto: todas.filter(esDeOtroPais) };
}

/** `false` para las zonas argentinas, en cualquiera de sus dos formas. */
function esDeOtroPais(zona: string): boolean {
  if (zona.startsWith(PREFIJO_ARGENTINA)) {
    return false;
  }
  const [region, ciudad] = zona.split('/');
  return !(region === 'America' && CIUDADES_ARGENTINAS.has(ciudad));
}

/** La base IANA del motor, o `null` si esta version de `Intl` no la expone. */
function zonasDelMotor(): readonly string[] | null {
  // El tipo de `Intl.supportedValuesOf` no esta en el lib de TypeScript que usa el proyecto,
  // asi que se consulta por su forma en vez de declararlo: si no esta, se usa el respaldo.
  const soportadas = (Intl as unknown as { supportedValuesOf?: (clave: string) => string[] })
    .supportedValuesOf;
  if (typeof soportadas !== 'function') {
    return null;
  }

  try {
    const zonas = soportadas('timeZone');
    return zonas.length === 0 ? null : zonas;
  } catch {
    // Un motor que conoce el metodo pero no la clave 'timeZone' tira. No es un error que
    // el usuario pueda resolver: se cae al respaldo y el alta sigue siendo posible.
    return null;
  }
}
