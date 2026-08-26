import { DiaEfectivoResponse } from '../../../api/generated/model/dia-efectivo-response';
import {
  FranjaResueltaResponse,
  FranjaResueltaResponseOrigenEnum,
} from '../../../api/generated/model/franja-resuelta-response';
import { HORA_MEDIANOCHE } from './horas-de-pared';
import {
  RUTA_HORARIOS,
  RUTA_HORARIOS_CALENDARIO,
  RUTA_HORARIOS_EXCEPCIONES,
} from './rutas-de-horarios';
import { sumarDias } from './ventana-de-fechas';

/**
 * Vocabulario de la <b>disponibilidad efectiva</b> de un profesional (M05, AKINE-02.04).
 *
 * <p>Este archivo existe por una razon muy concreta: <b>`razonVacio` y `recortadoPor` viajan
 * como `string | null` y el compilador no chequea nada</b>. El contrato les saco el `enum` a
 * proposito -un nullable con enum se publica en OpenAPI 3.1 con un tipo que admite el nulo y un
 * enum que no lo contiene, y un cliente estricto rechazaria nuestra propia respuesta-, asi que
 * la lista cerrada vive en la prosa del contrato y aca. Si los literales se repartieran por las
 * plantillas, una letra cambiada no rompe el build, no rompe el lint y deja un dia explicado
 * con el cartel equivocado.
 *
 * <p><b>Los cuatro estados de un dia vacio no son cuatro maneras de decir "cerrado".</b>
 * Confundir dos de ellos manda al administrador a buscar algo que no existe:
 *
 * <ul>
 *   <li><b>FERIADO</b> - es feriado y la sede cierra los feriados. Se dice <b>el nombre</b> del
 *       feriado: un dia que solo dice "cerrado" obliga a ir a buscar un cierre que nadie
 *       cargo.</li>
 *   <li><b>CIERRE</b> - una excepcion de tipo cierre tapo el dia entero. Tiene una fila
 *       concreta detras, y es la unica de las cuatro que se resuelve dando de baja algo.</li>
 *   <li><b>VINCULO</b> - el vinculo del profesional <b>no estaba vigente</b> ese dia: todavia
 *       no se habia incorporado, o ya no trabaja en la sede. <b>No es "no atiende ese dia"</b>,
 *       y darle el mismo cartel a los dos es el error que este archivo previene.</li>
 *   <li><b>null</b> - ninguna regla abrio el dia. Eso no es una regla que lo afecte: es la
 *       ausencia de reglas, o sea, un dia que la persona simplemente no trabaja.</li>
 * </ul>
 */

/** Es feriado del pais y la sede cierra los feriados. */
export const RAZON_VACIO_FERIADO = 'FERIADO';

/** Una excepcion de tipo cierre tapo el dia entero. `reglaVacio` trae su id. */
export const RAZON_VACIO_CIERRE = 'CIERRE';

/** El vinculo del profesional con la sede no estaba vigente ese dia. */
export const RAZON_VACIO_VINCULO = 'VINCULO';

/** Unico valor de `recortadoPor`: un cierre le comio un pedazo a la franja. */
export const RECORTE_POR_CIERRE = 'CIERRE';

/**
 * Adonde ir a mirar la regla que dejo el dia vacio.
 *
 * <p><b>`params` no es un adorno.</b> Las dos pantallas de destino tienen filtros propios con
 * valores por defecto que <b>no</b> son los del dia que se estaba mirando: excepciones abre en
 * "solo las de toda la sede" sobre noventa dias desde hoy. Un enlace pelado desde "la excepcion
 * de cierre numero 42 cubre el dia entero" aterriza en una lista donde el cierre 42 —si es de
 * Ana, que es el caso corriente de una ausencia— <b>no aparece</b>, sin ninguna senal de que un
 * filtro lo esta tapando. El salto tiene que llevar consigo de quien y de que dia se hablaba.
 */
export interface EnlaceDeRegla {
  readonly ruta: string;
  readonly texto: string;
  /** Query params que la pantalla de destino lee al abrir. `null` si no hace falta ninguno. */
  readonly params: Readonly<Record<string, string>> | null;
}

/** Un dia vacio, explicado. `enlace` es la pantalla donde se mira la regla, si la hay. */
export interface ExplicacionDeVacio {
  /** La frase corta que encabeza el dia. Nunca "cerrado" a secas. */
  readonly titulo: string;
  /** Por que quedo asi, y que hacer. */
  readonly detalle: string;
  /** Adonde ir a mirar la regla, ya filtrado por lo que la explicacion nombra. */
  readonly enlace: EnlaceDeRegla;
}

/**
 * La ventana de un solo dia, escrita con el fin exclusivo que usan las cuatro pantallas.
 *
 * <p>Sin fecha —que el contrato admite, porque todo campo del cliente generado es opcional— no
 * se inventa ninguna: el destino abre con su ventana por defecto, que es peor que la exacta pero
 * mucho mejor que una ventana equivocada.
 */
function ventanaDelDia(fecha: string | undefined): Record<string, string> {
  if (fecha === undefined || fecha === null || fecha === '') {
    return {};
  }
  return { desde: fecha, hasta: sumarDias(fecha, 1) };
}

/** El profesional del que se esta hablando, como query param. Vacio si no se sabe cual. */
function delProfesional(membershipId: number | null): Record<string, string> {
  return membershipId === null ? {} : { membershipId: String(membershipId) };
}

/**
 * Por que este dia no tiene ni una franja.
 *
 * <p>El nombre del profesional entra en el texto de `VINCULO` porque ahi la explicacion es
 * sobre <b>una persona</b> y no sobre la sede: "el vinculo no estaba vigente" sin decir de
 * quien se lee como un problema del centro.
 */
export function explicacionDeVacio(
  dia: DiaEfectivoResponse,
  nombreDelProfesional: string,
  membershipId: number | null = null,
): ExplicacionDeVacio {
  switch (dia.razonVacio) {
    case RAZON_VACIO_FERIADO:
      return {
        titulo: nombreDelFeriado(dia),
        detalle:
          'La sede cierra los feriados de su calendario, asi que el horario habitual no se ' +
          'aplica. Si este feriado en particular se atiende, se carga una apertura para ese dia.',
        enlace: {
          ruta: RUTA_HORARIOS_CALENDARIO,
          texto: 'Ver los feriados de la sede',
          params: ventanaDelDia(dia.fecha),
        },
      };

    case RAZON_VACIO_CIERRE:
      return {
        titulo: 'Cerrado por un cierre cargado.',
        detalle:
          detalleDelCierre(dia) +
          ' Un cierre tapa el horario habitual mientras esta vigente; se deshace dandolo de baja.',
        enlace: {
          ruta: RUTA_HORARIOS_EXCEPCIONES,
          texto: 'Ver los cierres y las aperturas',
          // El cierre puede ser de la sede o de esta persona, y el filtro por profesional trae
          // las DOS poblaciones. Sin `membershipId` el destino muestra solo las de sede y el
          // cierre que acaba de nombrarse por su numero no esta en la lista.
          params: { ...delProfesional(membershipId), ...ventanaDelDia(dia.fecha) },
        },
      };

    case RAZON_VACIO_VINCULO:
      return {
        titulo: `${nombreDelProfesional} no estaba vinculado a la sede ese dia.`,
        detalle:
          'No es que no atienda ese dia de la semana: ese dia todavia no se habia incorporado, ' +
          'o ya se habia desvinculado. Su horario semanal puede estar cargado igual, y no ' +
          'aplica fuera de la vigencia del vinculo.',
        enlace: {
          ruta: '/organizacion/colaboradores',
          texto: 'Ver el vinculo en Colaboradores',
          params: null,
        },
      };

    default:
      // `null` -o cualquier cosa que no reconozcamos- es la AUSENCIA de reglas: ninguna abrio
      // el dia. Ofrecer aca un cierre para dar de baja mandaria a buscar algo que no existe.
      return {
        titulo: 'No trabaja ese dia.',
        detalle:
          'Ninguna regla abre ese dia: no hay bloque del horario semanal que lo cubra ni ' +
          'apertura que lo habilite. No hay ningun cierre ni feriado de por medio.',
        enlace: {
          ruta: RUTA_HORARIOS,
          texto: 'Ver el horario semanal',
          params: delProfesional(membershipId),
        },
      };
  }
}

/** El feriado con su nombre. Sin nombre se degrada, pero nunca queda en "cerrado" a secas. */
function nombreDelFeriado(dia: DiaEfectivoResponse): string {
  const nombre = dia.feriadoNombre;
  if (nombre === undefined || nombre === null || nombre === '') {
    return 'Cerrado por un feriado del calendario nacional.';
  }
  return `Cerrado por el feriado: ${nombre}.`;
}

/** El cierre concreto, cuando el backend publica su id. */
function detalleDelCierre(dia: DiaEfectivoResponse): string {
  const regla = dia.reglaVacio;
  if (regla === undefined || regla === null) {
    return 'Una excepcion de cierre cubre el dia entero.';
  }
  return `La excepcion de cierre numero ${regla} cubre el dia entero.`;
}

/**
 * Que regla produjo la franja, dicha con palabras y con el id de la fila.
 *
 * <p>Sin esto la pantalla dibuja horas y el administrador no puede saber si las 09 a 13 del
 * martes salen del horario semanal o de una apertura puntual que alguien cargo, que es
 * justamente la diferencia entre "asi trabaja siempre" y "asi trabaja esta semana".
 */
export function etiquetaDeOrigen(franja: FranjaResueltaResponse): string {
  const id = franja.reglaId;
  const referencia = id === undefined || id === null ? '' : ` numero ${id}`;
  if (franja.origen === FranjaResueltaResponseOrigenEnum.APERTURA) {
    return `La produjo una apertura puntual${referencia}.`;
  }
  return `La produjo el horario semanal, bloque${referencia}.`;
}

/**
 * Por que la franja quedo mas corta que la regla que la produjo, o `null` si esta entera.
 *
 * <p>Es la respuesta a "por que termina a las 11 si el bloque llega hasta las 13".
 */
export function textoDeRecorte(franja: FranjaResueltaResponse): string | null {
  if (franja.recortadoPor !== RECORTE_POR_CIERRE) {
    return null;
  }
  return (
    'Recortada por un cierre: la franja termina antes de lo que dice la regla que la produjo. ' +
    'El resto del tramo quedo tapado por esa excepcion.'
  );
}

/**
 * La franja escrita en hora de pared de la sede: `"09:00 a 13:00"`.
 *
 * <p><b>Las franjas viajan en instantes UTC</b>, no en horas locales, y la zona viaja aparte en
 * `timezone` justamente para poder rotularlas. Formatear con la zona del navegador mostraria el
 * horario de la sede corrido segun donde este parado quien mira.
 *
 * <p><b>Una franja que llega al fin del dia trae el INICIO DEL DIA SIGUIENTE.</b> Mostrada tal
 * cual diria "de 20:00 a 00:00", que se lee como una franja invertida. Cuando el fin cae a la
 * medianoche de otra fecha se escribe `24:00`, que es como el propio horario semanal escribe ese
 * borde.
 */
export function rangoDeFranja(
  franja: FranjaResueltaResponse,
  fechaDelDia: string | undefined,
  timezone: string | undefined,
): string {
  const inicio = partesEnZona(franja.desde, timezone);
  const fin = partesEnZona(franja.hasta, timezone);
  if (inicio === null || fin === null) {
    return '';
  }
  const terminaEnOtroDia = fechaDelDia !== undefined && fin.fecha !== fechaDelDia;
  const horaFin = fin.hora === '00:00' && terminaEnOtroDia ? HORA_MEDIANOCHE : fin.hora;
  return `${inicio.hora} a ${horaFin}`;
}

/** La fecha y la hora de un instante, leidas en la zona de la sede. `null` si no se puede. */
function partesEnZona(
  instante: string | undefined,
  timezone: string | undefined,
): { readonly fecha: string; readonly hora: string } | null {
  if (instante === undefined || instante === null || instante === '') {
    return null;
  }
  const momento = new Date(instante);
  if (Number.isNaN(momento.getTime())) {
    return null;
  }
  const partes = formateador(timezone).formatToParts(momento);
  const leer = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find((parte) => parte.type === tipo)?.value ?? '';
  return {
    fecha: `${leer('year')}-${leer('month')}-${leer('day')}`,
    hora: `${leer('hour')}:${leer('minute')}`,
  };
}

/**
 * Formateador en la zona de la sede, con reloj `h23`.
 *
 * <p>Se fija `hourCycle` y no `hour12: false`: en varios locales `hour12: false` resuelve a
 * `h24` y la medianoche sale como `24:00` <b>sola</b>, con lo que ya no se podria distinguir el
 * fin del dia del comienzo. Aca la medianoche siempre es `00:00`, y la decision de escribirla
 * `24:00` la toma {@link rangoDeFranja}, que es la unica que sabe de que dia se trata.
 *
 * <p>Una zona que el navegador no conozca no puede tirar abajo la pantalla: se cae a la zona
 * local, y el rotulo de la respuesta sigue diciendo cual era la que mando el backend.
 */
function formateador(timezone: string | undefined): Intl.DateTimeFormat {
  const opciones: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  };
  if (timezone === undefined || timezone === null || timezone === '') {
    return new Intl.DateTimeFormat('es-AR', opciones);
  }
  try {
    return new Intl.DateTimeFormat('es-AR', { ...opciones, timeZone: timezone });
  } catch {
    return new Intl.DateTimeFormat('es-AR', opciones);
  }
}
