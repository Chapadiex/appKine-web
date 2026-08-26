/**
 * Fechas de calendario del modulo de horarios: <b>dias</b>, no instantes (M05, AKINE-02.04).
 *
 * <p>Los campos `fechaDesde`, `fechaHasta` y la ventana de consulta del contrato son fechas
 * locales `YYYY-MM-DD`, sin hora y sin zona. No se convierten a UTC como los instantes de
 * `shared/utils/instantes.ts`: un feriado del 25 de mayo es el 25 de mayo, y pasarlo por
 * `toISOString()` lo puede dejar en el 24 a las 21:00 —el bug clasico— sin que nada falle.
 *
 * <p>Por eso todo aca trabaja sobre el string, y las pocas veces que hace falta un `Date` se
 * construye con `new Date(anio, mes - 1, dia)`, que arma <b>mediodia local</b> del dia
 * correcto, y nunca con `new Date('2026-05-25')`, que segun la especificacion de JavaScript se
 * interpreta como <b>UTC</b> y en Argentina retrocede un dia.
 *
 * <p><b>El fin siempre es exclusivo.</b> Un cierre de un solo dia es `[D, D+1)`. Es la
 * convencion del contrato en las dos ventanas —la de consulta y la de la excepcion— y las
 * pantallas la dicen con palabras en vez de esperar que el usuario la deduzca.
 */

/** Ventana maxima que aceptan las dos consultas del modulo. Mas que eso es `400`. */
export const MAXIMO_DIAS_VENTANA = 366;

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

const EXPRESION_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const NOMBRES_DE_MES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** `true` si el texto tiene la forma `YYYY-MM-DD` que espera el contrato. */
export function esFechaDeCalendario(valor: string): boolean {
  return EXPRESION_FECHA.test(valor);
}

/** El dia de hoy en hora local, como `YYYY-MM-DD`. Nunca en UTC: hoy es hoy aca. */
export function hoyLocal(referencia: Date = new Date()): string {
  return comoFechaDeCalendario(referencia);
}

/** Un `Date` escrito como `YYYY-MM-DD` con sus componentes <b>locales</b>. */
function comoFechaDeCalendario(momento: Date): string {
  const mes = String(momento.getMonth() + 1).padStart(2, '0');
  const dia = String(momento.getDate()).padStart(2, '0');
  return `${momento.getFullYear()}-${mes}-${dia}`;
}

/**
 * La misma fecha corrida `dias` dias. Devuelve `''` si la entrada no es una fecha.
 *
 * <p>Se apoya en `Date` a proposito para no reimplementar los meses de 30 dias ni los años
 * bisiestos, pero construyendo el `Date` a partir de los tres numeros: parsear el string
 * directamente lo interpretaria como UTC.
 */
export function sumarDias(fecha: string, dias: number): string {
  const partido = aFechaLocal(fecha);
  if (partido === null) {
    return '';
  }
  partido.setDate(partido.getDate() + dias);
  return comoFechaDeCalendario(partido);
}

/**
 * Cuantos dias cubre la ventana `[desde, hasta)`. `null` si alguna fecha no es valida.
 *
 * <p>Negativo cuando la ventana esta invertida: quien llama decide si eso es un error suyo o
 * del usuario.
 */
export function diasEntre(desde: string, hasta: string): number | null {
  const inicio = aFechaLocal(desde);
  const fin = aFechaLocal(hasta);
  if (inicio === null || fin === null) {
    return null;
  }
  return Math.round((fin.getTime() - inicio.getTime()) / MILISEGUNDOS_POR_DIA);
}

/**
 * La fecha redactada: `"25 de mayo de 2026"`.
 *
 * <p>Se arma a mano y no con `toLocaleDateString`, cuyo resultado depende del locale del
 * navegador y del sistema operativo: en un test corriendo en `en-US` la misma fecha se
 * escribiria "May 25, 2026", y una pantalla en castellano mezclaria los dos idiomas segun la
 * maquina de quien la mire.
 */
export function etiquetaDeFecha(fecha: string | undefined): string {
  if (fecha === undefined || !esFechaDeCalendario(fecha)) {
    return fecha ?? '';
  }
  const [anio, mes, dia] = fecha.split('-');
  return `${Number(dia)} de ${NOMBRES_DE_MES[Number(mes) - 1]} de ${anio}`;
}

/** `Date` al mediodia local del dia indicado, o `null`. El mediodia evita el borde del huso. */
function aFechaLocal(fecha: string): Date | null {
  if (!esFechaDeCalendario(fecha)) {
    return null;
  }
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(anio, mes - 1, dia, 12);
}
