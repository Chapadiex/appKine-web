import {
  Obligacion,
  ObligacionConceptoEnum,
  ObligacionEstadoEnum,
} from '../../../api/generated/model/obligacion';

/**
 * Textos y formateo de la cuenta corriente (M18, AKINE-07.01).
 *
 * <p>Vive en `features/` y no en `shared/`: sabe que es una obligacion economica y que es un
 * saldo, o sea sabe de dominio.
 *
 * <h2>La regla que gobierna este archivo: aca no se hace aritmetica de plata</h2>
 *
 * <p>El contrato declara los importes como `number` —el generador no tiene otra cosa— y un
 * `number` de JavaScript es un flotante binario de doble precision. `0.1 + 0.2` da
 * `0.30000000000000004`, y sumar veinte saldos de una cuenta corriente produce un total con
 * centavos que no cuadran contra la base, que si guarda decimales exactos. Un total mal sumado en
 * una pantalla de deuda no es un detalle de presentacion: es el numero que alguien le dice a un
 * paciente.
 *
 * <p>Por eso <b>este archivo formatea y no calcula</b>. No hay ninguna funcion que sume, reste ni
 * compare importes, y la pantalla tampoco muestra un total: el backend no lo devuelve y
 * calcularlo aca seria inventarlo. Lo unico que se hace con un importe es convertirlo en texto.
 */

/**
 * Un importe, con la moneda que vino en la respuesta.
 *
 * <p><b>La moneda sale del dato y no de una constante.</b> Cablear `'ARS'` funcionaria hoy y
 * empezaria a mentir el dia que una organizacion opere en otra: el simbolo diria una cosa y el
 * numero seria de otra, que es la peor forma de estar mal porque nada falla.
 *
 * <p>Si la moneda no vino o no es un codigo ISO que el navegador conozca, se cae a un formato
 * numerico sin simbolo. `Intl.NumberFormat` lanza `RangeError` con un codigo invalido, y una
 * pantalla de deuda que se rompe entera por un campo mal cargado es peor que una que muestra el
 * numero pelado.
 */
export function importeEnPalabras(valor: number | undefined, moneda: string | undefined): string {
  if (valor === undefined || !Number.isFinite(valor)) {
    return '';
  }

  if (moneda !== undefined && moneda !== '') {
    try {
      return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: moneda,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(valor);
    } catch {
      // Codigo de moneda que este navegador no reconoce. Se sigue de largo con el formato
      // numerico: el importe importa mas que el simbolo.
    }
  }

  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valor);
}

/**
 * Rotulo del estado de la deuda.
 *
 * <p>Los tres primeros <b>se derivan del saldo</b> y `ANULADA` es una decision de alguien. El
 * texto lo refleja: "anulada" no es un estado al que una deuda llegue sola.
 */
export function estadoEnPalabras(estado: string | undefined): string {
  switch (estado) {
    case ObligacionEstadoEnum.PENDIENTE:
      return 'Pendiente';
    case ObligacionEstadoEnum.PARCIAL:
      return 'Pagada en parte';
    case ObligacionEstadoEnum.PAGADA:
      return 'Pagada';
    case ObligacionEstadoEnum.ANULADA:
      return 'Anulada';
    default:
      return estado ?? '';
  }
}

/**
 * Rotulo del concepto de la deuda (AKINE F-4): que parte de la prestacion es.
 *
 * <p>`FINANCIADOR` no deberia llegar a la cuenta corriente —el listado por persona trae solo lo
 * que debe el paciente— pero tiene su texto igual: si un dia aparece, que se lea como la parte de
 * la obra social y no como un codigo crudo.
 *
 * <p>Sin concepto (deudas devengadas antes de F-4) devuelve vacio: no se inventa uno.
 */
export function conceptoEnPalabras(concepto: string | undefined): string {
  switch (concepto) {
    case ObligacionConceptoEnum.PARTICULAR:
      return 'Particular';
    case ObligacionConceptoEnum.COSEGURO:
      return 'Coseguro';
    case ObligacionConceptoEnum.FINANCIADOR:
      return 'A cargo de la obra social';
    default:
      return concepto ?? '';
  }
}

/** Clase de la marca de estado. Reusa las tres del design system, sin colores propios. */
export function claseDeEstado(estado: string | undefined): string {
  if (estado === ObligacionEstadoEnum.ANULADA) {
    return 'marca-estado marca-estado--revocada';
  }
  if (estado === ObligacionEstadoEnum.PAGADA) {
    return 'marca-estado marca-estado--activa';
  }
  return 'marca-estado marca-estado--suspendida';
}

/**
 * `true` si la deuda todavia se puede anular.
 *
 * <p>Es <b>solo UX</b>: el backend rechaza igual con 409 y es la autoridad. Lo que evita es
 * ofrecer un boton que sabemos que va a fallar. No mira los cobros imputados —el listado no los
 * trae— asi que una obligacion `PENDIENTE` puede rechazarse igual, y ese caso se explica cuando
 * llega.
 */
export function sePuedeAnular(obligacion: Obligacion): boolean {
  return obligacion.estado !== ObligacionEstadoEnum.ANULADA;
}

/** Fecha legible de un instante UTC, con la zona del navegador. */
export function fechaEnPalabras(instante: string | undefined): string {
  if (instante === undefined || instante === '') {
    return '';
  }
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(fecha);
}
