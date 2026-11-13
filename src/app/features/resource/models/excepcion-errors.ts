import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import {
  ConflictoDelProblema,
  conflictoDelProblema,
  superposicionesDelProblema,
} from '../../../core/models/conflicto-de-agenda';
import {
  MensajeTraducido,
  conDetalle,
  mensajeTraducido,
  segundosDeEspera,
} from './errores-comunes';

/**
 * Motivo por el que fallo una operacion sobre <b>excepciones de disponibilidad</b> o sobre la
 * <b>politica de calendario</b> de la sede (M05, AKINE-02.04).
 *
 * <p><b>Por que un traductor propio y no `traducirErrorBloque`.</b> El criterio del repo es no
 * fusionar traductores que ramifican distinto, y estos dos ramifican distinto de verdad:
 *
 * <ul>
 *   <li>Dos excepciones de la misma sede que se pisan <b>no</b> son un 409: una ausencia de una
 *       tarde dentro de una licencia mas larga es un hecho corriente y las dos se guardan. El unico
 *       solapamiento es otro (0.158.0): una APERTURA de un profesional que se superpone con su
 *       horario en <b>otra</b> sede, que se resuelve sustituyendo esa franja de alla.</li>
 *   <li>Aparece `excepcion-already-inactive`, que `traducirErrorBloque` no ramifica.</li>
 *   <li>Los textos nombran <b>lo que se esta tocando</b>. Un 404 que dice "ese bloque ya no
 *       existe" en la pantalla de excepciones manda a buscar en el horario semanal algo que
 *       nunca estuvo ahi.</li>
 *   <li>La politica de calendario <b>no lleva `version` y no puede dar 409 de concurrencia</b>:
 *       gana el ultimo que guarda. Ofrecer "recarga y volve a intentar" seria describir un
 *       control que no existe.</li>
 * </ul>
 *
 * <p>Como en el resto del repo, se ramifica por `problemType` y <b>nunca</b> por el texto de
 * `detail`, que es prosa para humanos y cambia cuando alguien corrige una redaccion.
 */
export type CausaExcepcion =
  /** 403 missing-tenant-context: hay sesion, pero no hay sede elegida. NUNCA cerrar sesion. */
  | 'sin-contexto'
  /** 403 forbidden: falta `consultorio:manage` (mutar) o `colaborador:read` (leer). */
  | 'sin-permiso'
  /** 400 validation-error: fechas incoherentes, horas mal formadas, motivo fuera de la lista. */
  | 'validacion'
  /** 404: la excepcion no existe, es de otra sede o de otro tenant. */
  | 'no-encontrado'
  /** 409 excepcion-already-inactive: la baja ya estaba hecha. Distinto de "no existe". */
  | 'ya-inactiva'
  /** 409 consultorio-inactive: la sede esta dada de baja y no origina hechos nuevos. */
  | 'sede-inactiva'
  /** 409 profesional-no-vinculado: esa membership no atiende en ESTA sede. */
  | 'profesional-no-vinculado'
  /** 409 bloqueo-con-turnos-afectados: se reservo algo despues de la consulta de impacto. */
  | 'turnos-afectados'
  /**
   * 409 bloque-solapado de una APERTURA (0.158.0): la persona ya ofrece esa franja en otra sede. Ver
   * `conflictos`. Se resuelve reenviando con `sustituirDisponibilidadSuperpuesta`.
   */
  | 'superpuesta'
  /**
   * 409 recurso-ocupado de una APERTURA (0.158.0): la persona tiene un turno o una clase en otra sede
   * en esa franja. Lo reservado no se sustituye nunca.
   */
  | 'actividad-reservada'
  /** 400 ventana-demasiado-amplia: la ventana pedida supera el tope. Ver `maximoDias`. */
  | 'ventana-amplia'
  /** 409 subscription-suspended: lo emite el filtro, antes del controller. */
  | 'suscripcion-suspendida'
  /** 429: hay que esperar. Ver `segundosDeEspera`. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/** Error ya traducido a algo mostrable. */
export interface ErrorExcepcion extends MensajeTraducido<CausaExcepcion> {
  /** Tope de dias que el backend acepta. Solo en `ventana-amplia`; 0 en el resto. */
  readonly maximoDias: number;
  /**
   * Con que choca, en `superpuesta` (cada franja de `superposiciones`) y en
   * `actividad-reservada` (la actividad). Vacio en el resto.
   */
  readonly conflictos: readonly ConflictoDelProblema[];
}

const MENSAJE_GENERICO = 'No pudimos completar la operación. Volvé a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volvé a intentar.';
const MENSAJE_LIMITE_SIN_PLAZO =
  'Demasiados intentos. Espera un momento antes de volver a intentar.';

const MENSAJE_SIN_CONTEXTO =
  'Los cierres, las aperturas y los feriados son de una sede concreta y todavía no elegiste ' +
  'ninguna. Eligi un consultorio para verlos y editarlos.';

const MENSAJE_SIN_PERMISO =
  'No tenés permiso para administrar los cierres y las aperturas de esta sede. Pediselo a quien ' +
  'la administra.';

const MENSAJE_NO_ENCONTRADO =
  'Esa excepción ya no existe o pertenece a otra sede. Recarga la ventana para ver las que hay ' +
  'ahora.';

const MENSAJE_YA_INACTIVA =
  'Esa excepción ya estaba dada de baja, seguramente por otra persona. Recarga la ventana para ' +
  'ver como quedo. No es lo mismo que no existir: la fila sigue ahi, con su motivo y su autor.';

/**
 * La sede esta dada de baja.
 *
 * <p>El texto dice tambien <b>que si se puede hacer</b>: dar de baja las excepciones cargadas.
 * Es con lo que se ordena el calendario de un centro que esta cerrando, y el backend lo permite
 * a proposito.
 */
const MENSAJE_SEDE_INACTIVA =
  'La sede esta dada de baja y no admite cierres ni aperturas nuevos. Los que ya tenia si se ' +
  'pueden dar de baja, que es con lo que se ordena el calendario de un centro que cierra.';

const MENSAJE_NO_VINCULADO =
  'Ese profesional no tiene un vinculo vigente que lo habilite a atender en esta sede, así que ' +
  'no se le puede cargar una excepción acá. Revisalo en Colaboradores: puede estar acotado a ' +
  'otra sede, suspendido o vencido.';

/** Solo llega sin la confirmacion: la consulta previa dijo que no habia turnos, y ahora hay. */
const MENSAJE_TURNOS_AFECTADOS =
  'Se reservaron turnos en ese período mientras cargabas el cierre, así que no se guardó. Volvé a ' +
  'enviarlo para ver cuáles quedan afectados y confirmar.';

const MENSAJE_SUPERPUESTA =
  'El profesional ya ofrece esa franja en otra agenda y no puede atender en dos lugares a la vez. ' +
  'Ajustá la apertura, o cerrá aquella franja para abrir esta.';

const MENSAJE_ACTIVIDAD_RESERVADA =
  'El profesional ya tiene un turno o una clase en esa franja, así que no se puede abrir acá. Lo ' +
  'reservado no se sustituye: elegí otra franja o reubicá primero esa actividad.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripción de la organización esta suspendida, así que no se pueden registrar cambios. ' +
  'Se resuelve desde la pantalla de suscripción.';

/** Traduce cualquier error de las pantallas de excepciones y de calendario de la sede. */
export function traducirErrorExcepcion(error: unknown): ErrorExcepcion {
  if (!(error instanceof AkineHttpError)) {
    return base(MENSAJE_GENERICO, 'otro');
  }

  if (error.esDeRed) {
    return base(MENSAJE_DE_RED, 'red');
  }

  if (error.esRateLimited) {
    const segundos = segundosDeEspera(error);
    return {
      ...base(
        segundos > 0
          ? `Demasiados intentos. Espera ${segundos} segundos y volvé a intentar.`
          : MENSAJE_LIMITE_SIN_PLAZO,
        'limite',
      ),
      segundosDeEspera: segundos,
    };
  }

  switch (error.problemType) {
    case 'missing-tenant-context':
      return base(MENSAJE_SIN_CONTEXTO, 'sin-contexto');
    case 'excepcion-already-inactive':
      return base(MENSAJE_YA_INACTIVA, 'ya-inactiva');
    case 'consultorio-inactive':
      return base(MENSAJE_SEDE_INACTIVA, 'sede-inactiva');
    case 'profesional-no-vinculado':
      return base(MENSAJE_NO_VINCULADO, 'profesional-no-vinculado');
    case 'bloqueo-con-turnos-afectados':
      return base(MENSAJE_TURNOS_AFECTADOS, 'turnos-afectados');
    case 'bloque-solapado': {
      const superposiciones = superposicionesDelProblema(error);
      return {
        ...base(conDetalle(error, MENSAJE_SUPERPUESTA), 'superpuesta'),
        conflictos: superposiciones.length > 0 ? superposiciones : [conflictoDelProblema(error)],
      };
    }
    case 'recurso-ocupado':
      return {
        ...base(conDetalle(error, MENSAJE_ACTIVIDAD_RESERVADA), 'actividad-reservada'),
        conflictos: [conflictoDelProblema(error)],
      };
    case 'subscription-suspended':
      return base(MENSAJE_SUSCRIPCION_SUSPENDIDA, 'suscripcion-suspendida');
    case 'ventana-demasiado-amplia': {
      const maximo = error.numeroDeExtension('maximoDias') ?? 0;
      return {
        ...base(mensajeDeVentana(maximo), 'ventana-amplia'),
        maximoDias: maximo,
      };
    }
    default:
      break;
  }

  if (error.status === 403) {
    return base(MENSAJE_SIN_PERMISO, 'sin-permiso');
  }

  if (error.status === 404) {
    // Inexistente, de otra sede y de otro tenant responden igual: distinguirlos permitiria
    // reconstruir el calendario de cualquier centro probando ids.
    return base(MENSAJE_NO_ENCONTRADO, 'no-encontrado');
  }

  if (error.status === 400) {
    // El backend nombra el campo concreto; su texto es mas util que cualquier generico.
    return base(conDetalle(error, MENSAJE_GENERICO), 'validacion');
  }

  return base(conDetalle(error, MENSAJE_GENERICO), 'otro');
}

/**
 * La ventana pedida es mas larga de lo que el backend acepta.
 *
 * <p>El tope viaja en la extension `maximoDias` justamente para que la pantalla pueda decirlo
 * en vez de dejar al usuario acortando a ciegas. Sin la extension se degrada a un texto sin
 * numero: inventar uno seria peor que no decirlo.
 */
function mensajeDeVentana(maximoDias: number): string {
  if (maximoDias <= 0) {
    return 'La ventana que pediste es demasiado larga. Consulta un periodo mas corto.';
  }
  return (
    `La ventana que pediste es demasiado larga: el máximo es de ${maximoDias} días. ` +
    'Acorta el periodo y volvé a consultar.'
  );
}

function base(mensaje: string, causa: CausaExcepcion): ErrorExcepcion {
  return { ...mensajeTraducido(mensaje, causa), maximoDias: 0, conflictos: [] };
}
