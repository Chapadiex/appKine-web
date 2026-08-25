import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Motivo por el que fallo una operacion sobre el catalogo clinico (M06, AKINE-02.05).
 *
 * <p>Se ramifica por `problemType` y <b>nunca</b> por el texto de `detail`, por lo mismo que
 * en espacios: `detail` es prosa y cambia cuando alguien corrige una redaccion.
 *
 * <p><b>No se fusiona con `espacio-errors.ts`.</b> Son features distintos y ramifican
 * distinto: aca los `409` incluyen dos que alla no existen -el solapamiento de vigencias y
 * el cruce de alcances- y el `403` tiene <b>dos</b> lecturas que no se pueden confundir:
 * "no administras este centro" y "esto es de la plataforma y no es tuyo".
 */
export type CausaCatalogo =
  /** 403 missing-tenant-context: hay sesion, pero no hay centro elegido. NUNCA cerrar sesion. */
  | 'sin-contexto'
  /** 403 forbidden: falta permiso sobre el centro, o el concepto es de la plataforma. */
  | 'sin-permiso'
  /** 400 validation-error. */
  | 'validacion'
  /** 404: no existe, es de otro tenant, o es un tipo que no esta en la ruta. */
  | 'no-encontrado'
  /** 409 catalogo-code-taken: ya hay un concepto vigente con ese codigo. */
  | 'codigo-tomado'
  /** 409 catalogo-name-taken: ya hay un concepto vigente con ese nombre. */
  | 'nombre-tomado'
  /** 409 catalogo-inactive: esta dado de baja y no admite ediciones. */
  | 'concepto-inactivo'
  /** 409 catalogo-already-inactive: la baja ya estaba hecha. Hay que recargar. */
  | 'ya-inactivo'
  /** 409 catalogo-reference-inactive: la especialidad o practica referenciada esta de baja. */
  | 'referencia-inactiva'
  /** 409 catalogo-has-active-references: hay conceptos vigentes que cuelgan de este. */
  | 'con-dependientes'
  /** 409 catalogo-scope-mismatch: un concepto global no puede depender de uno del centro. */
  | 'alcance-cruzado'
  /** 409 nomenclador-vigencia-overlap: dos vigencias del mismo codigo se pisan en el tiempo. */
  | 'vigencias-solapadas'
  /** 409 catalogo-solicitud-duplicada: ya hay una solicitud pendiente igual. */
  | 'solicitud-duplicada'
  /** 409 catalogo-solicitud-ya-resuelta: otra persona ya la resolvio. */
  | 'solicitud-resuelta'
  /** 409 concurrent-modification: la `version` enviada quedo vieja. */
  | 'concurrencia'
  /** 409 subscription-suspended: lo emite el filtro, antes del controller. */
  | 'suscripcion-suspendida'
  /** 429: hay que esperar. Ver `segundosDeEspera`. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/** Error ya traducido a algo mostrable. */
export interface ErrorCatalogo {
  readonly mensaje: string;
  readonly causa: CausaCatalogo;
  /** Segundos a esperar antes de reintentar. 0 fuera de `limite`. */
  readonly segundosDeEspera: number;
}

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
const MENSAJE_LIMITE_SIN_PLAZO =
  'Demasiados intentos. Espera un momento antes de volver a intentar.';

const MENSAJE_SIN_CONTEXTO =
  'El catalogo mezcla los conceptos de la plataforma con los de tu centro, asi que hay que saber ' +
  'en cual estas trabajando. Eligi un consultorio y volve a entrar.';

/**
 * `403` sobre el catalogo.
 *
 * <p>Nombra <b>las dos</b> causas posibles, porque el backend no distingue: quien recibe
 * esto o no administra el centro, o esta intentando tocar un concepto de la plataforma.
 * La segunda tiene salida -la solicitud de RF-M06-005- y por eso se nombra: sin eso, quien
 * quiere una especialidad global nueva no tiene ninguna forma de enterarse de que existe un
 * camino para pedirla.
 */
const MENSAJE_SIN_PERMISO =
  'No podes modificar esto. O no administras este centro -pediselo a quien lo administra-, o el ' +
  'concepto es de la plataforma: esos los mantiene AKINE y se piden desde la pantalla de ' +
  'solicitudes al catalogo global.';

const MENSAJE_NO_ENCONTRADO =
  'Ese concepto ya no existe, o no es de este centro. Recarga el listado para ver los que hay ahora.';

/**
 * Codigo o nombre ya tomados.
 *
 * <p>Aclaran lo mismo que en espacios y por el mismo motivo: el unique es entre los conceptos
 * <b>vigentes</b>, asi que el de uno dado de baja SI se puede reusar, y sin decirlo el usuario
 * ve "ya existe" sobre algo que no encuentra en su listado filtrado por activos.
 *
 * <p>Y aclaran algo que espacios no necesitaba: el choque puede ser contra un concepto
 * <b>de la plataforma</b>, que el filtro por alcance esconde si esta puesto en los del centro.
 */
const MENSAJE_CODIGO_TOMADO =
  'Ya hay un concepto vigente con ese codigo. Ojo con dos cosas: el codigo de uno dado de baja SI ' +
  'se puede reusar -mira el filtro Todos-, y el que choca puede ser un concepto de la plataforma, ' +
  'que el filtro por alcance puede estar escondiendo.';

const MENSAJE_NOMBRE_TOMADO =
  'Ya hay un concepto vigente con ese nombre. Igual que con el codigo: el de uno dado de baja se ' +
  'puede reusar, y el que choca puede ser uno de la plataforma que el filtro esta escondiendo.';

const MENSAJE_CONCEPTO_INACTIVO =
  'Este concepto esta dado de baja y por eso no se puede editar. La baja no se deshace: lo que ya ' +
  'quedo registrado con el conserva su significado, y si hace falta de nuevo se crea uno nuevo.';

const MENSAJE_YA_INACTIVO =
  'Este concepto ya estaba dado de baja, seguramente por otra persona. Recarga el listado para ver ' +
  'el estado actual.';

const MENSAJE_REFERENCIA_INACTIVA =
  'La especialidad o la practica que elegiste esta dada de baja, asi que no se le puede colgar ' +
  'nada nuevo. Elegi una vigente, o dala de alta primero.';

const MENSAJE_ALCANCE_CRUZADO =
  'Un concepto de la plataforma no puede depender de uno de tu centro: lo verian todos los ' +
  'centros y ninguno tendria acceso a lo que cuelga. Elegi una referencia que tambien sea de la ' +
  'plataforma.';

const MENSAJE_VIGENCIAS_SOLAPADAS =
  'Ya hay una vigencia de ese codigo que se pisa con la ventana que estas cargando. Dos vigencias ' +
  'del mismo codigo no pueden convivir: cerra la anterior antes de que empiece la nueva.';

const MENSAJE_SOLICITUD_DUPLICADA =
  'Ya hay una solicitud pendiente por ese mismo concepto. Esperala: pedirlo dos veces no la ' +
  'acelera, y la vas a ver resuelta en este mismo listado.';

const MENSAJE_SOLICITUD_RESUELTA =
  'Esta solicitud ya fue resuelta, seguramente por otra persona. Recarga el listado para ver como ' +
  'quedo.';

const MENSAJE_CONCURRENCIA =
  'Alguien mas modifico este concepto mientras lo estabas editando, asi que no guardamos tus ' +
  'cambios para no pisar los suyos. Volvimos a leer los datos actuales: revisalos y confirma de ' +
  'nuevo si seguis queriendo el cambio.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripcion de la organizacion esta suspendida, asi que no se pueden registrar cambios. Se ' +
  'resuelve desde la pantalla de suscripcion.';

/**
 * Hay conceptos vigentes que cuelgan de este.
 *
 * <p>Es el unico `409` del modulo donde lo accionable <b>no</b> esta en esta pantalla, igual
 * que el de referencias de espacios: nombra que hay y cuanto, porque la diferencia entre "no
 * se pudo" y "hay 12 practicas colgando de esta especialidad" es la diferencia entre llamar a
 * soporte y resolverlo solo.
 */
function mensajeDeDependientes(error: AkineHttpError): string {
  const tipo = error.extension('referenceType');
  const cantidad = error.numeroDeExtension('referenceCount');

  if (typeof tipo === 'string' && cantidad !== null) {
    return (
      `No se puede dar de baja este concepto porque todavia hay ${cantidad} ${tipo} vigentes que ` +
      'dependen de el. Dalos de baja primero, o mudalos a otro.'
    );
  }
  return (
    'No se puede dar de baja este concepto porque todavia hay conceptos vigentes que dependen de ' +
    'el. Resolvelos primero y volve a intentar.'
  );
}

/**
 * Traduce cualquier error de las pantallas de catalogo.
 *
 * <p><b>El `detail` del backend gana solo donde no hay nada mejor que decir</b>: en
 * `validation-error` el servidor nombra el campo concreto. En los `409` el frontend sabe
 * cosas que el backend no -que hay un filtro por alcance escondiendo el conflicto, que existe
 * el camino de la solicitud- y por eso escribe el suyo.
 */
export function traducirErrorCatalogo(error: unknown): ErrorCatalogo {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: MENSAJE_GENERICO, causa: 'otro', segundosDeEspera: 0 };
  }

  if (error.esDeRed) {
    return { mensaje: MENSAJE_DE_RED, causa: 'red', segundosDeEspera: 0 };
  }

  if (error.esRateLimited) {
    const segundos = segundosDeEspera(error);
    return {
      mensaje:
        segundos > 0
          ? `Demasiados intentos. Espera ${segundos} segundos y volve a intentar.`
          : MENSAJE_LIMITE_SIN_PLAZO,
      causa: 'limite',
      segundosDeEspera: segundos,
    };
  }

  switch (error.problemType) {
    case 'missing-tenant-context':
      return { mensaje: MENSAJE_SIN_CONTEXTO, causa: 'sin-contexto', segundosDeEspera: 0 };
    case 'catalogo-code-taken':
      return { mensaje: MENSAJE_CODIGO_TOMADO, causa: 'codigo-tomado', segundosDeEspera: 0 };
    case 'catalogo-name-taken':
      return { mensaje: MENSAJE_NOMBRE_TOMADO, causa: 'nombre-tomado', segundosDeEspera: 0 };
    case 'catalogo-inactive':
      return {
        mensaje: MENSAJE_CONCEPTO_INACTIVO,
        causa: 'concepto-inactivo',
        segundosDeEspera: 0,
      };
    case 'catalogo-already-inactive':
      return { mensaje: MENSAJE_YA_INACTIVO, causa: 'ya-inactivo', segundosDeEspera: 0 };
    case 'catalogo-reference-inactive':
      return {
        mensaje: MENSAJE_REFERENCIA_INACTIVA,
        causa: 'referencia-inactiva',
        segundosDeEspera: 0,
      };
    case 'catalogo-has-active-references':
      return {
        mensaje: mensajeDeDependientes(error),
        causa: 'con-dependientes',
        segundosDeEspera: 0,
      };
    case 'catalogo-scope-mismatch':
      return { mensaje: MENSAJE_ALCANCE_CRUZADO, causa: 'alcance-cruzado', segundosDeEspera: 0 };
    case 'nomenclador-vigencia-overlap':
      return {
        mensaje: MENSAJE_VIGENCIAS_SOLAPADAS,
        causa: 'vigencias-solapadas',
        segundosDeEspera: 0,
      };
    case 'catalogo-solicitud-duplicada':
      return {
        mensaje: MENSAJE_SOLICITUD_DUPLICADA,
        causa: 'solicitud-duplicada',
        segundosDeEspera: 0,
      };
    case 'catalogo-solicitud-ya-resuelta':
      return {
        mensaje: MENSAJE_SOLICITUD_RESUELTA,
        causa: 'solicitud-resuelta',
        segundosDeEspera: 0,
      };
    case 'concurrent-modification':
      return { mensaje: MENSAJE_CONCURRENCIA, causa: 'concurrencia', segundosDeEspera: 0 };
    case 'subscription-suspended':
      return {
        mensaje: MENSAJE_SUSCRIPCION_SUSPENDIDA,
        causa: 'suscripcion-suspendida',
        segundosDeEspera: 0,
      };
    default:
      break;
  }

  if (error.status === 403) {
    return { mensaje: MENSAJE_SIN_PERMISO, causa: 'sin-permiso', segundosDeEspera: 0 };
  }

  if (error.status === 404) {
    // Concepto inexistente, de otro tenant y tipo equivocado responden los tres igual:
    // distinguirlos permitiria enumerar el catalogo de otros centros probando ids.
    return { mensaje: MENSAJE_NO_ENCONTRADO, causa: 'no-encontrado', segundosDeEspera: 0 };
  }

  if (error.status === 400) {
    // El backend nombra el campo concreto; su texto es mas util que cualquier generico.
    return {
      mensaje: conDetalle(error, MENSAJE_GENERICO),
      causa: 'validacion',
      segundosDeEspera: 0,
    };
  }

  return { mensaje: conDetalle(error, MENSAJE_GENERICO), causa: 'otro', segundosDeEspera: 0 };
}

/** `true` si el error corresponde al campo <b>nombre</b> del formulario. */
export function esErrorDelNombre(causa: CausaCatalogo | null): boolean {
  return causa === 'nombre-tomado';
}

/** `true` si el error corresponde al campo <b>codigo</b> del formulario. */
export function esErrorDelCodigo(causa: CausaCatalogo | null): boolean {
  return causa === 'codigo-tomado';
}

/** El mensaje del backend, o el de respaldo si el cuerpo no traia `ProblemDetail`. */
function conDetalle(error: AkineHttpError, respaldo: string): string {
  return error.problem === null ? respaldo : error.message;
}

/**
 * Espera declarada por el backend en `Retry-After`, o `0` si no la mando.
 *
 * <p>Misma decision que en el resto de las pantallas: sin header <b>no se inventa un
 * numero</b>.
 */
function segundosDeEspera(error: AkineHttpError): number {
  const segundos = error.reintentarEnSegundos;
  if (segundos === null || !Number.isFinite(segundos) || segundos <= 0) {
    return 0;
  }
  return Math.ceil(segundos);
}
