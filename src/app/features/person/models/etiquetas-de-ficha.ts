import { AdjuntoResponse } from '../../../api/generated/model/adjunto-response';
import { HitoResponse } from '../../../api/generated/model/hito-response';
import { IndicadorResponse } from '../../../api/generated/model/indicador-response';
import { SeccionOmitidaResponse } from '../../../api/generated/model/seccion-omitida-response';
import { CategoriaDeAdjunto } from '../services/adjuntos-api';

/**
 * Como se redacta en pantalla lo que devuelven la ficha 360 y los adjuntos (M07/M25, AKINE-03.02).
 *
 * <p>Vive aparte de las pantallas por lo mismo que `etiquetas-de-person.ts`: las decisiones de
 * redaccion se pueden leer y probar sin montar un componente.
 *
 * <h2>Todo lo de aca degrada, y ninguna funcion asume que el campo vino</h2>
 *
 * <p>El contrato declara opcional practicamente cada propiedad de estas respuestas, asi que un
 * `!` o un `??` optimista compila y despues escribe "undefined" en el DOM de la ficha de un
 * paciente. Cada funcion devuelve algo legible para el caso ausente, y ese texto es una decision:
 * "sin fecha" no es lo mismo que una celda vacia.
 */

// -----------------------------------------------------------------------------------------
// Secciones del 360
// -----------------------------------------------------------------------------------------

/**
 * Nombre en pantalla de una seccion del 360.
 *
 * <p><b>El fallback devuelve la clave cruda y eso es deliberado.</b> Las secciones las declaran los
 * modulos que aportan —hoy `scheduling` y `billing`, manana los que se agreguen— y el contrato no
 * las enumera: es un `string` libre. Una seccion nueva tiene que aparecer en la ficha aunque este
 * frontend no la conozca, con su clave por titulo, en vez de desaparecer sin dejar rastro. Lo
 * contrario seria que agregar un contribuyente del lado del backend produzca un hueco invisible.
 */
const NOMBRES_DE_SECCION: Record<string, string> = {
  turnos: 'Turnos',
  economia: 'Situacion economica',
  coberturas: 'Coberturas',
  documentos: 'Documentacion administrativa',
};

export function nombreDeSeccion(seccion: string | undefined): string {
  if (seccion === undefined || seccion === '') {
    return 'Seccion';
  }
  return NOMBRES_DE_SECCION[seccion] ?? seccion;
}

/**
 * Que decirle a alguien que no puede ver una seccion.
 *
 * <p>Es el texto mas importante de la pantalla y por eso esta aca y no incrustado en la plantilla.
 * El backend <b>recorta y no rechaza</b>: la seccion sin permiso no se pide y viaja en
 * `seccionesOmitidas`. Si la pantalla la omitiera tambien, el operador leeria "sin turnos" donde
 * en realidad dice "no podes ver los turnos", y esa diferencia decide si llama al paciente para
 * confirmarle un turno que existe.
 *
 * <p>Nombra el permiso que falta —el backend lo manda— porque es el dato con el que se pide: sin
 * el, quien administra el centro tiene que adivinar que habilitar.
 */
export function omisionEnPalabras(omitida: SeccionOmitidaResponse): string {
  const permiso = omitida.permisoRequerido;
  if (permiso === undefined || permiso === '') {
    return 'No tenes permiso para ver esta seccion. No es que no haya datos: no se consultaron.';
  }
  return (
    'No tenes permiso para ver esta seccion, asi que no se consulto. No significa que no haya ' +
    `datos. Hace falta el permiso ${permiso}: pediselo a quien administra el centro.`
  );
}

/**
 * Un indicador ya redactado: su etiqueta y su valor.
 *
 * <p>El backend manda `cantidad` o `importe`, nunca los dos, y el importe viene con su `moneda`.
 * <b>La pantalla no suma ni convierte nada</b>: es la misma regla que la cuenta corriente —un
 * `number` es un flotante binario y la aritmetica sobre plata produce centavos que no cuadran—,
 * solo que aca ni siquiera hay una lista que tentaria a totalizar.
 */
export function valorDeIndicador(indicador: IndicadorResponse): string {
  if (indicador.importe !== undefined) {
    return importeEnPalabras(indicador.importe, indicador.moneda);
  }
  if (indicador.cantidad !== undefined) {
    return String(indicador.cantidad);
  }
  return 'Sin dato';
}

export function etiquetaDeIndicador(indicador: IndicadorResponse): string {
  return indicador.etiqueta ?? indicador.clave ?? 'Indicador';
}

/**
 * Un hito en una linea: que paso, cuando y en que estado quedo.
 *
 * <p>`titulo` y `estado` los redacta el modulo que aporta —"Turno" con `CONFIRMADO`, el nombre de
 * la prestacion con `PENDIENTE`— y aca <b>no se traducen</b>. Traducirlos obligaria a este archivo
 * a conocer las maquinas de estado de `scheduling` y de `billing`, que es exactamente la
 * dependencia que la etapa invirtio para que el 360 crezca sin tocar `person`.
 */
export function hitoEnPalabras(hito: HitoResponse): string {
  const cuando = fechaEnPalabras(hito.ocurrioEn);
  const titulo = hito.titulo ?? hito.tipo ?? 'Hecho registrado';
  const estado = hito.estado === undefined || hito.estado === '' ? '' : ` — ${hito.estado}`;
  return cuando === '' ? `${titulo}${estado}` : `${cuando} — ${titulo}${estado}`;
}

// -----------------------------------------------------------------------------------------
// Adjuntos
// -----------------------------------------------------------------------------------------

const NOMBRES_DE_CATEGORIA: Record<string, string> = {
  DOCUMENTO_IDENTIDAD: 'Documento de identidad',
  CREDENCIAL_COBERTURA: 'Credencial de cobertura',
  CONSENTIMIENTO: 'Consentimiento',
  AUTORIZACION: 'Autorizacion',
  COMPROBANTE: 'Comprobante',
  OTRO: 'Otro',
};

export function nombreDeCategoria(categoria: string | undefined): string {
  return categoria === undefined ? '' : (NOMBRES_DE_CATEGORIA[categoria] ?? categoria);
}

/** `true` cuando la categoria es una de las seis del contrato. Para leer un `select`. */
export function esCategoria(valor: string): valor is CategoriaDeAdjunto {
  return Object.prototype.hasOwnProperty.call(NOMBRES_DE_CATEGORIA, valor);
}

/**
 * Como se llama el documento en la tabla.
 *
 * <p>El titulo es opcional y el nombre del archivo no: cuando no hay titulo se muestra el nombre
 * original, que es como el operador lo reconoce. Nunca queda vacio, porque una fila sin nombre no
 * se puede elegir.
 */
export function nombreDeAdjunto(adjunto: AdjuntoResponse): string {
  const titulo = adjunto.titulo;
  if (titulo !== undefined && titulo.trim() !== '') {
    return titulo;
  }
  return adjunto.nombreArchivo ?? 'Documento sin nombre';
}

/** `true` cuando el adjunto esta dado de baja: se descarga, no se modifica. */
export function adjuntoInactivo(adjunto: AdjuntoResponse): boolean {
  return adjunto.estadoCicloDeVida === 'INACTIVO';
}

/**
 * `true` cuando el almacenamiento perdio el binario.
 *
 * <p>Se muestra <b>antes</b> de que el operador toque descargar, en vez de dejar que se entere con
 * el 409: el listado ya trae el dato, y ofrecerle un boton que se sabe que falla es hacerle perder
 * el viaje.
 */
export function adjuntoNoDisponible(adjunto: AdjuntoResponse): boolean {
  return adjunto.estado === 'NO_DISPONIBLE';
}

/** Vive en `shared/utils/archivos`: lo comparten personas y adjuntos clinicos. */
export { tamanoEnPalabras } from '../../../shared/utils/archivos';

// -----------------------------------------------------------------------------------------
// Fechas e importes
// -----------------------------------------------------------------------------------------

/**
 * Una fecha o un instante, en el formato en que se lee una ficha.
 *
 * <p><b>Los `LocalDate` se parten a mano y no pasan por `new Date()`</b>, y esto es el bug que la
 * funcion existe para no tener. `new Date('2026-09-15')` se interpreta como medianoche UTC, y en
 * un huso al oeste de Greenwich —el de todo el pais— eso se formatea como el 14. Una vigencia que
 * empieza el 15 mostrada como el 14 es un dato equivocado en la pantalla que decide si al paciente
 * se lo puede atender.
 *
 * <p>Los instantes con hora si van por `Date`: ahi la conversion al huso local es lo correcto,
 * porque el hecho ocurrio en un momento y se mira desde donde se lo mira.
 */
export function fechaEnPalabras(valor: string | undefined | null): string {
  if (valor === undefined || valor === null || valor === '') {
    return '';
  }

  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (soloFecha !== null) {
    return `${soloFecha[3]}/${soloFecha[2]}/${soloFecha[1]}`;
  }

  const instante = new Date(valor);
  if (Number.isNaN(instante.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(instante);
}

/**
 * Un importe con su moneda.
 *
 * <p>Mismo criterio que la cuenta corriente: si el navegador no reconoce el codigo de moneda se
 * sigue de largo con el formato numerico, porque el importe importa mas que el simbolo.
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
      // Codigo de moneda desconocido para este navegador. No es motivo para no mostrar el numero.
    }
  }

  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valor);
}
