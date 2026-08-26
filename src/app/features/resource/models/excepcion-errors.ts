import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
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
 *   <li>Las excepciones <b>no tienen 409 de solapamiento</b>, y no es un olvido del backend: dos
 *       excepciones que se pisan sin ser identicas son las dos legitimas —una ausencia de una
 *       tarde dentro de una licencia mas larga es un hecho corriente— y las dos se guardan.
 *       Escribir aca el manejo del solapamiento seria codigo muerto para siempre.</li>
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
}

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
const MENSAJE_LIMITE_SIN_PLAZO =
  'Demasiados intentos. Espera un momento antes de volver a intentar.';

const MENSAJE_SIN_CONTEXTO =
  'Los cierres, las aperturas y los feriados son de una sede concreta y todavia no elegiste ' +
  'ninguna. Eligi un consultorio para verlos y editarlos.';

const MENSAJE_SIN_PERMISO =
  'No tenes permiso para administrar los cierres y las aperturas de esta sede. Pediselo a quien ' +
  'la administra.';

const MENSAJE_NO_ENCONTRADO =
  'Esa excepcion ya no existe o pertenece a otra sede. Recarga la ventana para ver las que hay ' +
  'ahora.';

const MENSAJE_YA_INACTIVA =
  'Esa excepcion ya estaba dada de baja, seguramente por otra persona. Recarga la ventana para ' +
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
  'Ese profesional no tiene un vinculo vigente que lo habilite a atender en esta sede, asi que ' +
  'no se le puede cargar una excepcion aca. Revisalo en Colaboradores: puede estar acotado a ' +
  'otra sede, suspendido o vencido.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripcion de la organizacion esta suspendida, asi que no se pueden registrar cambios. ' +
  'Se resuelve desde la pantalla de suscripcion.';

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
          ? `Demasiados intentos. Espera ${segundos} segundos y volve a intentar.`
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
    `La ventana que pediste es demasiado larga: el maximo es de ${maximoDias} dias. ` +
    'Acorta el periodo y volve a consultar.'
  );
}

function base(mensaje: string, causa: CausaExcepcion): ErrorExcepcion {
  return { ...mensajeTraducido(mensaje, causa), maximoDias: 0 };
}
