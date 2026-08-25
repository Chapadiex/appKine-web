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
 * Instante UTC en ISO-8601 a partir de lo que escribio el usuario en hora local.
 *
 * <p>Devuelve `null` si el campo esta vacio o si el navegador entrego algo que no es una
 * fecha: un valor invalido tiene que <b>omitirse</b> del cuerpo, no viajar como
 * `"Invalid Date"` para que el backend lo rechace con un `400` que no explica cual campo.
 */
export function aInstanteUtc(valorLocal: string): string | null {
  if (valorLocal === '') {
    return null;
  }
  const fecha = new Date(valorLocal);
  if (Number.isNaN(fecha.getTime())) {
    return null;
  }
  return fecha.toISOString();
}

/**
 * Valor para un `<input type="datetime-local">` a partir de un instante UTC.
 *
 * <p>Se arma a mano con los getters locales y no con `toISOString().slice(0, 16)`, que es el
 * atajo que todo el mundo escribe: ese devuelve la hora <b>UTC</b>, asi que el control
 * mostraria las 21:00 del dia anterior y el usuario "corregiria" una fecha que estaba bien.
 */
export function aCampoLocal(instante: string | undefined | null): string {
  if (instante === undefined || instante === null || instante === '') {
    return '';
  }
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) {
    return '';
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
 * Instante formateado para leer, en la zona del navegador.
 *
 * <p>Devuelve `null` -y no el string crudo- cuando no hay dato: quien lo muestra decide si
 * eso se lee como "-", como "sin fin previsto" o como nada, y esa decision depende de que
 * campo sea.
 */
export function formatearInstante(instante: string | undefined | null): string | null {
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
  });
}
