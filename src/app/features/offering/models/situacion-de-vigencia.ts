import { OfertaResponse } from '../../../api/generated/model/oferta-response';

/**
 * Por que una oferta se ofrece -o no- para una reserva <b>hoy</b> (M27, AKINE-02.06).
 *
 * <h2>La distincion que esta pantalla no puede aplanar</h2>
 *
 * <p>`estado` y `vigenteHoy` <b>no son lo mismo</b>. Es exactamente la misma trampa que
 * `features/resource` ya documenta para los espacios entre "activo" y "en servicio", y se
 * resuelve igual, a proposito: dos modulos que aplanan la misma distincion de dos formas
 * distintas producen dos reportes de bug distintos por la misma causa.
 *
 * <ul>
 *   <li><b>`estado`</b> (ACTIVO / INACTIVO) es el <b>ciclo de vida administrativo</b>: si la
 *       oferta fue dada de baja o no. La baja es logica, terminal y con motivo, y no borra
 *       nada: lo que ya se reservo con esta oferta la sigue referenciando.</li>
 *   <li><b>`vigenteHoy`</b> dice si <b>hoy</b> se puede reservar. Exige `estado = ACTIVO`
 *       <b>y ademas</b> que hoy caiga dentro de `[vigenciaDesde, vigenciaHasta)`.</li>
 * </ul>
 *
 * <p>De ahi sale el caso que hay que explicar si o si: una oferta <b>ACTIVA</b> que arranca el
 * mes que viene tiene `estado = ACTIVO` y `vigenteHoy = false`, y <b>es correcto</b> que no
 * aparezca todavia en un selector de reserva. Una pantalla que solo muestre "Activa" deja esa
 * fila indistinguible de una operativa, alguien la busca en la agenda, no la encuentra y lo
 * reporta como bug de la agenda. El bug seria de esta pantalla, por no decir lo que ya sabia.
 *
 * <h2>El calculo es del backend, y no se replica</h2>
 *
 * <p>`vigenteHoy` <b>se calcula en la zona horaria de la sede</b>, no en la del navegador. Un
 * usuario que administra una sede desde otro huso -o simplemente con el reloj corrido- veria
 * "vigente" o "todavia no" al reves si esta pantalla lo recalculara. Por eso la decision sale
 * siempre del campo del backend.
 *
 * <p>Las fechas locales se usan <b>solo para redactar</b> el motivo -"arranca el 1/9"-. Si no
 * se puede precisar por cual de los dos extremos cae afuera, se dice que esta fuera de su
 * ventana y listo, que sigue siendo cierto.
 *
 * <p><b>El fin de vigencia es exclusivo</b>, igual que las ventanas de M05: una oferta con
 * `vigenciaHasta = 2026-09-01` deja de ofrecerse <b>ese</b> dia, no al dia siguiente. La
 * plantilla lo dice con palabras en vez de esperar que el usuario lo deduzca.
 */
export type ClaveDeVigencia =
  /** ACTIVA y dentro de la ventana: se ofrece para reservar. */
  | 'vigente'
  /** ACTIVA pero `vigenciaDesde` todavia no llego. */
  | 'aun-no'
  /** ACTIVA pero `vigenciaHasta` ya paso. */
  | 'ya-no'
  /** ACTIVA y fuera de la ventana, sin poder precisar por cual de los dos extremos. */
  | 'fuera-de-ventana'
  /** INACTIVA: dada de baja. La ventana ya no importa. */
  | 'dada-de-baja';

export interface SituacionDeVigencia {
  readonly clave: ClaveDeVigencia;
  /** Texto corto de la marca de estado. Ej: "Activa, todavia sin vigencia". */
  readonly resumen: string;
  /** Por que, y que hacer. `null` cuando no hay nada que aclarar. */
  readonly explicacion: string | null;
  /** `true` si la fila se pinta atenuada: no se ofrece para reservar. */
  readonly atenuada: boolean;
}

/**
 * Frase que cierra las tres explicaciones de "activa pero sin vigencia".
 *
 * <p>Es <b>corta</b> a proposito: la definicion completa de los dos terminos vive una sola vez,
 * arriba de la tabla. Repetirla entera en cada fila hace que la columna de estado mida cuatro
 * renglones por oferta y que nadie la lea. Lo que la fila tiene que decir es el motivo
 * <b>de esa fila</b>.
 */
const NO_APARECE = 'no aparece en los selectores de reserva.';

/**
 * Clasifica una oferta, con el motivo redactado.
 *
 * <p>`hoy` entra por parametro como `YYYY-MM-DD` y no se lee de `Date.now()` adentro: asi la
 * funcion es pura y su test no depende del reloj de la maquina que lo corre.
 *
 * <p>Las comparaciones son <b>entre strings</b> y no entre `Date`. Dos motivos: `YYYY-MM-DD`
 * ordena lexicograficamente igual que cronologicamente, y `new Date('2026-05-25')` se
 * interpreta como <b>UTC</b> segun la especificacion de JavaScript, asi que en Argentina
 * retrocede un dia — el bug clasico que `features/resource` ya documenta para los feriados.
 */
export function situacionDeVigencia(oferta: OfertaResponse, hoy: string): SituacionDeVigencia {
  if (oferta.estado === 'INACTIVO') {
    return {
      clave: 'dada-de-baja',
      resumen: 'Dada de baja',
      explicacion: null,
      atenuada: true,
    };
  }

  if (oferta.vigenteHoy === true) {
    return {
      clave: 'vigente',
      resumen: 'Activa y vigente',
      explicacion: null,
      atenuada: false,
    };
  }

  const desde = oferta.vigenciaDesde ?? '';
  if (desde !== '' && desde > hoy) {
    return {
      clave: 'aun-no',
      resumen: 'Activa, todavia sin vigencia',
      explicacion:
        `Arranca el ${enPalabras(desde)}, y hasta entonces ${NO_APARECE} No es un error: la ` +
        'oferta ya esta cargada y va a empezar a ofrecerse sola ese dia.',
      atenuada: true,
    };
  }

  const hasta = oferta.vigenciaHasta ?? '';
  if (hasta !== '' && hasta <= hoy) {
    return {
      clave: 'ya-no',
      resumen: 'Activa, vigencia terminada',
      explicacion:
        `Sigue activa, pero su vigencia termino el ${enPalabras(hasta)} —el fin es exclusivo, ` +
        `asi que ese dia ya no se ofrecio—, y por eso ${NO_APARECE} Si vuelve a ofrecerse, ` +
        'edita el fin de vigencia en vez de dar de alta otra oferta igual.',
      atenuada: true,
    };
  }

  return {
    clave: 'fuera-de-ventana',
    resumen: 'Activa, sin vigencia hoy',
    explicacion: `Hoy queda fuera de su ventana de vigencia, asi que ${NO_APARECE}`,
    atenuada: true,
  };
}

/**
 * El dia de hoy en hora <b>local</b>, como `YYYY-MM-DD`.
 *
 * <p>Nunca en UTC: hoy es hoy aca. Solo se usa para <b>redactar</b> motivos, jamas para
 * decidir si una oferta esta vigente — esa decision es del backend, en la zona de la sede.
 */
export function hoyLocal(referencia: Date = new Date()): string {
  const mes = String(referencia.getMonth() + 1).padStart(2, '0');
  const dia = String(referencia.getDate()).padStart(2, '0');
  return `${referencia.getFullYear()}-${mes}-${dia}`;
}

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

/**
 * `2026-09-01` -&gt; `1 de septiembre de 2026`. Devuelve el original si no tiene esa forma.
 *
 * <p>Se parte el string en vez de construir un `Date`, por el mismo motivo que la comparacion:
 * pasar por `Date` en una fecha sin hora es la forma mas comun de perder un dia.
 */
export function enPalabras(fecha: string): string {
  const partes = fecha.split('-');
  if (partes.length !== 3) {
    return fecha;
  }
  const mes = Number(partes[1]);
  const dia = Number(partes[2]);
  if (!Number.isInteger(mes) || mes < 1 || mes > 12 || !Number.isInteger(dia)) {
    return fecha;
  }
  return `${dia} de ${NOMBRES_DE_MES[mes - 1]} de ${partes[0]}`;
}
