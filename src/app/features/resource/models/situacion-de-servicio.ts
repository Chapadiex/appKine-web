import { EspacioResponse } from '../../../api/generated/model/espacio-response';
import { formatearInstante } from '../../../shared/utils/instantes';

/**
 * Por que un espacio se ofrece -o no- para una reserva <b>ahora</b> (RN-M04-002).
 *
 * <h2>La distincion que la pantalla no puede aplanar</h2>
 *
 * <p>`estado` y `enServicio` <b>no son lo mismo</b>, y confundirlos genera el reporte de bug
 * mas caro de este modulo:
 *
 * <ul>
 *   <li><b>`estado`</b> (ACTIVO / INACTIVO) es el <b>ciclo de vida administrativo</b>: si el
 *       espacio fue dado de baja o no. La baja es logica, terminal y con motivo.</li>
 *   <li><b>`enServicio`</b> dice si <b>hoy</b> se puede reservar. Exige `estado = ACTIVO`
 *       <b>y ademas</b> estar dentro de la ventana operativa `[validFrom, validUntil)`.</li>
 * </ul>
 *
 * <p>De ahi sale el caso que hay que explicar si o si: un box <b>ACTIVO</b> que entra en
 * servicio el mes que viene tiene `estado = ACTIVO` y `enServicio = false`. Una pantalla que
 * solo muestre "Activo" deja a esa fila indistinguible de un box operativo, el box no aparece
 * en el selector de reserva, y alguien lo reporta como bug de la agenda. El bug seria de esta
 * pantalla, por no decir lo que ya sabia.
 *
 * <p><b>Se calcula con `enServicio` del backend, no en el cliente.</b> El reloj del navegador
 * puede estar corrido y la autoridad es el servidor. Las fechas locales se usan solo para
 * <b>redactar</b> el motivo -"entra en servicio el 1/9"-, nunca para decidir si esta en
 * servicio: si el motivo no se puede determinar, se dice que esta fuera de su ventana y
 * listo, que sigue siendo cierto.
 */
export type ClaveDeServicio =
  /** ACTIVO y dentro de la ventana: se ofrece para reservar. */
  | 'en-servicio'
  /** ACTIVO pero `validFrom` todavia no llego. */
  | 'aun-no'
  /** ACTIVO pero `validUntil` ya paso. */
  | 'ya-no'
  /** ACTIVO y fuera de la ventana, sin poder precisar por cual de los dos extremos. */
  | 'fuera-de-ventana'
  /** INACTIVO: dado de baja. La ventana ya no importa. */
  | 'dado-de-baja';

export interface SituacionDeServicio {
  readonly clave: ClaveDeServicio;
  /** Texto corto de la marca de estado. Ej: "Activo, sin servicio aun". */
  readonly resumen: string;
  /** Por que, y que hacer. `null` cuando no hay nada que aclarar. */
  readonly explicacion: string | null;
  /** `true` si la fila se pinta como atenuada: no se ofrece para reservar. */
  readonly atenuada: boolean;
}

/**
 * Frase que cierra las tres explicaciones de "activo pero sin servicio".
 *
 * <p>Es <b>corta</b> a proposito: la definicion completa de los dos terminos vive una sola vez,
 * arriba de la tabla. Repetirla entera en cada fila hacia que la columna de estado midiera
 * cuatro renglones por espacio y que nadie la leyera —se ve en la captura de la primera
 * version—. Lo que la fila tiene que decir es el motivo <b>de esa fila</b>.
 */
const NO_APARECE = 'no aparece en los selectores de reserva.';

/**
 * Clasifica un espacio, con el motivo redactado.
 *
 * <p>El `ahora` entra por parametro y no se lee de `Date.now()` adentro: asi la funcion es
 * pura y su test no depende del reloj de la maquina que lo corre.
 */
export function situacionDeServicio(espacio: EspacioResponse, ahora: Date): SituacionDeServicio {
  if (espacio.estado === 'INACTIVO') {
    return {
      clave: 'dado-de-baja',
      resumen: 'Dado de baja',
      explicacion: null,
      atenuada: true,
    };
  }

  if (espacio.enServicio === true) {
    return {
      clave: 'en-servicio',
      resumen: 'Activo y en servicio',
      explicacion: null,
      atenuada: false,
    };
  }

  const desde = instante(espacio.validFrom);
  if (desde !== null && desde.getTime() > ahora.getTime()) {
    return {
      clave: 'aun-no',
      resumen: 'Activo, todavia sin servicio',
      explicacion:
        `Entra en servicio el ${formatearInstante(espacio.validFrom)}, y hasta entonces ` +
        NO_APARECE,
      atenuada: true,
    };
  }

  const hasta = instante(espacio.validUntil);
  if (hasta !== null && hasta.getTime() <= ahora.getTime()) {
    return {
      clave: 'ya-no',
      resumen: 'Activo, fuera de servicio',
      explicacion:
        `Sigue activo, pero su vigencia termino el ${formatearInstante(espacio.validUntil)}, ` +
        `asi que ${NO_APARECE} Si volvio a estar disponible, edita el fin de vigencia en vez ` +
        'de darlo de alta de nuevo.',
      atenuada: true,
    };
  }

  return {
    clave: 'fuera-de-ventana',
    resumen: 'Activo, sin servicio',
    explicacion: `Hoy queda fuera de su ventana de vigencia, asi que ${NO_APARECE}`,
    atenuada: true,
  };
}

function instante(valor: string | undefined): Date | null {
  if (valor === undefined || valor === '') {
    return null;
  }
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}
