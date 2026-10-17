/**
 * Conversion entre el instante UTC del contrato y el `<input type="datetime-local">`.
 *
 * <p><b>Por que no alcanza con pasar el string tal cual.</b> El contrato habla en instantes
 * ISO-8601 en UTC (`2026-09-01T00:00:00Z`) y el control del navegador habla en hora <b>local
 * sin zona</b> (`2026-09-01T00:00`). Son dos cosas distintas: en Argentina difieren tres
 * horas. Enchufar uno en el otro sin convertir produce el bug clasico del modulo -un box que
 * entra en servicio "el 1 a las 00:00" y en la base figura el 31 a las 21:00-, que ademas
 * solo se nota en produccion si el servidor de CI corre en UTC.
 *
 * <p><b>Vive en `shared/` porque no sabe de dominio.</b> Aca no hay ninguna regla sobre
 * ventanas de vigencia, topes de 31 dias ni espacios: eso es de la feature. Esto es la
 * traduccion entre dos formatos de fecha, y la necesita cualquier pantalla que edite un
 * instante.
 */

/**
 * La zona IANA pedida, o `undefined` —la del navegador— si vino vacia o el navegador no la conoce.
 *
 * <p>La zona de la sede sale de `DiaDeLaSede.zona()`, que esta vacia hasta que el contexto la
 * resuelve: caer a la del navegador es lo mismo que hace `hoyEnZona` y lo que habia antes. `Intl`
 * lanza ante una zona invalida, y una excepcion en un formateo dejaria la pantalla en blanco por
 * un rotulo.
 */
export function zonaOVacio(zona: string | undefined | null): string | undefined {
  if (zona === undefined || zona === null || zona === '') {
    return undefined;
  }
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zona });
    return zona;
  } catch {
    return undefined;
  }
}

const EXPRESION_CAMPO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Los componentes de pared de un instante en una zona, leidos como si fueran UTC (ms). */
function paredEnZona(instante: number, zona: string): number {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instante));
  const leer = (tipo: Intl.DateTimeFormatPartTypes): number =>
    Number(partes.find((parte) => parte.type === tipo)?.value ?? '0');
  return Date.UTC(
    leer('year'),
    leer('month') - 1,
    leer('day'),
    leer('hour'),
    leer('minute'),
    leer('second'),
  );
}

/**
 * Instante UTC en ISO-8601 a partir de lo que escribio el usuario en un `datetime-local`.
 *
 * <p><b>Con `zona`</b>, el valor se lee como hora de pared de esa zona —la de la sede—, no la del
 * navegador: quien opera un consultorio de Cordoba desde otro huso escribe "22:30" pensando en la
 * hora del consultorio. Sin zona (o con una que el navegador no conoce) se lee en la del
 * navegador, que es lo que hacia antes.
 *
 * <p>Devuelve `null` si el campo esta vacio o si el navegador entrego algo que no es una
 * fecha: un valor invalido tiene que <b>omitirse</b> del cuerpo, no viajar como
 * `"Invalid Date"` para que el backend lo rechace con un `400` que no explica cual campo.
 */
export function aInstanteUtc(valorLocal: string, zona?: string | null): string | null {
  if (valorLocal === '') {
    return null;
  }
  const deZona = zonaOVacio(zona);
  const partes = EXPRESION_CAMPO_LOCAL.exec(valorLocal);
  if (deZona === undefined || partes === null) {
    const fecha = new Date(valorLocal);
    return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
  }
  const pared = Date.UTC(
    Number(partes[1]),
    Number(partes[2]) - 1,
    Number(partes[3]),
    Number(partes[4]),
    Number(partes[5]),
    Number(partes[6] ?? '0'),
  );
  // Primera aproximacion con el desfase de la zona en ese momento, y una correccion por si el
  // desfase cambia entre la aproximacion y el resultado (cambio de horario de verano).
  let instante = pared - (paredEnZona(pared, deZona) - pared);
  instante = pared - (paredEnZona(instante, deZona) - instante);
  return new Date(instante).toISOString();
}

/**
 * Valor para un `<input type="datetime-local">` a partir de un instante UTC.
 *
 * <p><b>Con `zona`</b> muestra la hora de pared de esa zona —la de la sede—; sin ella, la del
 * navegador. En los dos casos se arma a mano y no con `toISOString().slice(0, 16)`, que es el
 * atajo que todo el mundo escribe: ese devuelve la hora <b>UTC</b>, asi que el control
 * mostraria las 21:00 del dia anterior y el usuario "corregiria" una fecha que estaba bien.
 */
export function aCampoLocal(instante: string | undefined | null, zona?: string | null): string {
  if (instante === undefined || instante === null || instante === '') {
    return '';
  }
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) {
    return '';
  }
  const deZona = zonaOVacio(zona);
  if (deZona !== undefined) {
    return new Date(paredEnZona(fecha.getTime(), deZona)).toISOString().slice(0, 16);
  }
  const dosDigitos = (n: number): string => String(n).padStart(2, '0');
  return (
    `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}` +
    `T${dosDigitos(fecha.getHours())}:${dosDigitos(fecha.getMinutes())}`
  );
}

/**
 * `true` si los dos strings denotan el mismo momento, aunque esten escritos distinto.
 *
 * <p><b>Comparar los strings no alcanza.</b> Un valor que dio la vuelta por el control del
 * navegador vuelve como `2026-09-01T00:00:00.000Z` mientras el backend lo habia mandado como
 * `2026-09-01T00:00:00Z`: son el mismo instante y dos strings distintos. Un `PATCH` que
 * compare texto concluye que el usuario cambio la fecha y reenvia el campo en cada guardado,
 * que es exactamente lo que la semantica de campo omitido existe para evitar.
 *
 * <p>Un valor ausente es igual a otro ausente, y distinto de cualquier instante.
 */
export function mismoInstante(a: string | undefined | null, b: string | undefined | null): boolean {
  const uno = aInstanteUtc(a ?? '');
  const otro = aInstanteUtc(b ?? '');
  return uno === otro;
}

/**
 * Instante formateado para leer (fecha y hora), en `zona` —la de la sede— o, sin ella, en la del
 * navegador.
 *
 * <p>Devuelve `null` -y no el string crudo- cuando no hay dato: quien lo muestra decide si
 * eso se lee como "-", como "sin fin previsto" o como nada, y esa decision depende de que
 * campo sea.
 */
export function formatearInstante(
  instante: string | undefined | null,
  zona?: string | null,
): string | null {
  if (instante === undefined || instante === null || instante === '') {
    return null;
  }
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) {
    return null;
  }
  return fecha.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    // Reloj de 24 horas: en la tabla de espacios, 'a. m.'/'p. m.' agrega dos palabras a cada
    // celda de vigencia y la medianoche se lee '12:00 a. m.', que es justo la hora que mas
    // aparece cuando una vigencia arranca al principio de un dia.
    hour12: false,
    timeZone: zonaOVacio(zona),
  });
}

/** Solo la hora (`22:30`) de un instante, en `zona` o en la del navegador. `null` sin dato. */
export function formatearHora(
  instante: string | undefined | null,
  zona?: string | null,
): string | null {
  if (instante === undefined || instante === null || instante === '') {
    return null;
  }
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) {
    return null;
  }
  return fecha.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zonaOVacio(zona),
  });
}

/**
 * Fecha de negocio legible (`14/10/2026`).
 *
 * <p><b>Dos clases de dato, dos tratamientos.</b> Una fecha pura del contrato (`LocalDate`,
 * `2026-10-14`) es un dia de calendario y <b>no se convierte</b>: pasarla por `Date` la leeria
 * como medianoche UTC y en Argentina retrocederia al 13. Un instante (`2026-10-15T01:30:00Z`) si
 * se convierte, a la zona de la sede: una deuda devengada a las 22:30 del 14 en Cordoba es del 14
 * aunque el navegador ya este en el 15. Sin zona, la del navegador.
 */
export function formatearFecha(valor: string | undefined | null, zona?: string | null): string {
  if (valor === undefined || valor === null || valor === '') {
    return '';
  }
  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (soloFecha !== null) {
    return `${soloFecha[3]}/${soloFecha[2]}/${soloFecha[1]}`;
  }
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: zonaOVacio(zona),
  }).format(fecha);
}
