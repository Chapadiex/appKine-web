/**
 * Horas de pared del horario semanal: <b>texto</b>, nunca instantes.
 *
 * <p>Los campos `horaDesde` y `horaHasta` del contrato son `string` a proposito y no
 * `format: time`. Un lunes de 09:00 tiene que seguir siendo 09:00 despues de un cambio de
 * huso o de horario de verano, asi que no hay ningun `Date` correcto que los represente: el
 * unico dato es el texto.
 *
 * <p><b>La consecuencia practica es {@link HORA_MEDIANOCHE}.</b> Un bloque que llega al final
 * del dia viaja como `"24:00"`, que deliberadamente <b>no</b> es un `partial-time` valido de
 * RFC 3339 —`00:00` significaria el principio del dia, y la hora de fin es EXCLUSIVA—. Ni
 * `new Date()` ni un `<input type="time">` lo aceptan: el primero da `Invalid Date` y el
 * segundo vacia el control sin avisar. Por eso estas funciones trabajan sobre el string y por
 * eso los formularios de horarios usan `type="text"` con {@link PATRON_HORA}.
 *
 * <p><b>Nada de aca reformatea una hora para enviarla.</b> Lo que llega es lo que se muestra
 * y lo que se manda; {@link minutosDeHora} existe solo para comparar y ordenar del lado del
 * cliente, y su resultado nunca vuelve al cable.
 */

/** Fin del dia. El unico valor que expresa "hasta la medianoche" en un extremo exclusivo. */
export const HORA_MEDIANOCHE = '24:00';

/**
 * `HH:MM` de 00:00 a 23:59, mas el caso especial `24:00`.
 *
 * <p>Se usa tal cual como `pattern` del campo y como validador del formulario: si los dos
 * criterios se escribieran por separado, el navegador y Angular podrian discrepar sobre la
 * misma hora.
 */
export const PATRON_HORA = '([01][0-9]|2[0-3]):[0-5][0-9]|24:00';

const EXPRESION_HORA = new RegExp(`^(?:${PATRON_HORA})$`);

/** `true` si el texto es una hora de pared admisible para el contrato. */
export function esHoraDePared(valor: string): boolean {
  return EXPRESION_HORA.test(valor);
}

/**
 * Minutos desde la medianoche, o `null` si el texto no es una hora valida.
 *
 * <p>Solo para <b>comparar y ordenar</b> del lado del cliente: que el fin sea posterior al
 * inicio, y que los bloques de un dia salgan en orden. `24:00` da 1440, que es justamente lo
 * que lo hace comparable con el resto sin ningun caso especial.
 */
export function minutosDeHora(valor: string): number | null {
  if (!esHoraDePared(valor)) {
    return null;
  }
  const [horas, minutos] = valor.split(':');
  return Number(horas) * 60 + Number(minutos);
}

/**
 * La hora tal como se muestra: el string que llego, sin tocar.
 *
 * <p>Existe como funcion y no como interpolacion directa para que quede un solo lugar donde
 * alguien pueda sentir la tentacion de parsear —y para que el `undefined` de un contrato con
 * todos los campos opcionales no termine imprimiendo la palabra "undefined" en la grilla.
 */
export function etiquetaDeHora(valor: string | undefined): string {
  return valor ?? '';
}

/**
 * Rango horario redactado. `"09:00 a 12:00"`, o `"09:00 a medianoche"` cuando termina en 24:00.
 *
 * <p>La medianoche se nombra en palabras porque `"24:00"` a secas se lee como un error de
 * carga. El valor que se envia sigue siendo el string original: esto es solo el rotulo.
 */
export function rangoHorario(desde: string | undefined, hasta: string | undefined): string {
  const fin = hasta === HORA_MEDIANOCHE ? 'medianoche (24:00)' : etiquetaDeHora(hasta);
  return `${etiquetaDeHora(desde)} a ${fin}`;
}
