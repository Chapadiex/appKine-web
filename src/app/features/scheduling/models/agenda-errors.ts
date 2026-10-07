import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Motivo por el que fallo una operacion de agenda o de reserva (M12, AKINE-05.01 y 05.02).
 *
 * <p>Se ramifica por `problemType` y <b>nunca</b> por el texto de `detail`, igual que en el resto
 * de las features: `detail` es prosa y cambia cuando alguien corrige una redaccion.
 *
 * <h2>Los cuatro conflictos de la reserva son cuatro pantallas distintas</h2>
 *
 * <p>Es la razon por la que este archivo existe y lo que el backend publico a proposito como
 * cuatro tipos y no como un `conflict` generico. Cada uno lleva a una accion distinta, y meterlos
 * en una bolsa comun le devuelve al usuario un "no se pudo" sin salida:
 *
 * <ul>
 *   <li><b>`slot-no-disponible`</b>: el hueco dejo de existir entre que se dibujo la grilla y se
 *       apreto confirmar. La accion es <b>recargar la agenda</b>. Viaja con `motivo`, que dice
 *       cual de todas las cosas cambio.</li>
 *   <li><b>`slot-completo`</b>: el horario sigue existiendo, lo que se acabo es el cupo. La accion
 *       es <b>ofrecer el turno siguiente</b>, no recargar: recargar mostraria el mismo horario
 *       lleno. Viaja con `cupoTotal`.</li>
 *   <li><b>`recurso-ocupado`</b>: el profesional o el box ya tienen otro turno que se cruza. La
 *       accion es <b>elegir otro horario o profesional</b>. Viaja con `recurso`, que dice cual de
 *       los dos.</li>
 *   <li><b>`persona-sin-perfil-paciente`</b>: la reserva es valida, lo que falta es el perfil
 *       clinico. La accion es <b>activar el perfil</b> desde el padron. No es un error de agenda
 *       y por eso no se resuelve en la agenda.</li>
 * </ul>
 *
 * <p>Y el quinto, que no es del usuario: <b>`idempotency-key-conflict`</b> significa que la misma
 * clave se mando con otro pedido. Es un bug del cliente —la clave tiene que ser una por intento y
 * estable entre reintentos de ese intento— y el unico remedio honesto es empezar el intento de
 * nuevo con una clave nueva.
 *
 * <h2>Y los dos del ciclo de vida (AKINE-05.03)</h2>
 *
 * <ul>
 *   <li><b>`turno-transicion-no-permitida`</b>: el turno ya cerro su ciclo, o su ventana temporal
 *       no admite la operacion. Viaja con `motivo`, que es lo que separa "ya esta cancelado" de
 *       "ya empezo". La accion es <b>releer el turno</b>.</li>
 *   <li><b>`turno-con-atencion`</b>: hay una Sesion registrada sobre ese turno. La accion es
 *       <b>ir a la atencion</b>, no reintentar: no hay nada que refrescar.</li>
 * </ul>
 *
 * <p><b>La version vieja NO tiene tipo propio</b>, y conviene saberlo. Las tres transiciones que
 * llevan `expectedVersion` rechazan con `OptimisticLockingFailureException`, que el handler global
 * del backend mapea al `conflict` generico —el catalogo tiene `concurrent-modification` y
 * `scheduling` no lo usa—. Aca cae en la causa `conflicto`, con el `detail` del servidor, que dice
 * releer y reintentar. Es la deuda transversal que el workspace ya tiene anotada.
 */
export type CausaAgenda =
  /** 400 `ventana-demasiado-amplia`. Ver `maxDays`: la pantalla recorta sola y reintenta. */
  | 'ventana-demasiado-amplia'
  /** 400 validation-error. El backend nombra el campo. */
  | 'validacion'
  /** 403 missing-tenant-context: hay sesion, pero no hay sede elegida. NUNCA cerrar sesion. */
  | 'sin-contexto'
  /** 403 forbidden: falta `turno:read` para mirar la agenda o `turno:manage` para reservar. */
  | 'sin-permiso'
  /** 404: la sede, la oferta, la persona o el turno no existen, o son de otro tenant. */
  | 'no-encontrado'
  /** 409 `oferta-inactiva` / `oferta-no-agendable`: la oferta no se puede agendar en esa ventana. */
  | 'oferta-no-agendable'
  /** 409 `slot-no-disponible`: recargar la agenda. Ver `motivo`. */
  | 'slot-no-disponible'
  /** 409 `slot-completo`: ofrecer el turno siguiente. Ver `cupoTotal`. */
  | 'slot-completo'
  /** 409 `recurso-ocupado`: elegir otro horario o profesional. Ver `recurso`. */
  | 'recurso-ocupado'
  /** 409 `persona-sin-perfil-paciente`: activar el perfil desde el padron. */
  | 'persona-sin-perfil-paciente'
  /** 409 `idempotency-key-conflict`: la clave se reuso con otro pedido. Bug del cliente. */
  | 'clave-reusada'
  /**
   * 409 `turno-transicion-no-permitida`: el ciclo del turno no admite esa operacion (AKINE-05.03).
   *
   * <p>Un solo tipo para dos familias —"ya esta cancelado" y "ya empezo"—, con el detalle en
   * `motivo`. El backend lo publico asi a proposito: para la pantalla el desenlace es el mismo,
   * releer el turno y explicar por que no se puede.
   */
  | 'turno-transicion-no-permitida'
  /**
   * 409 `turno-con-atencion`: el turno tiene una Sesion registrada (AKINE-05.03, DP-05).
   *
   * <p><b>Tipo propio y no el de transicion</b>, porque lleva a otra parte: no hay nada que
   * refrescar, hay una atencion que resolver. Ninguna transicion administrativa puede borrar la
   * prueba de que la atencion ocurrio.
   */
  | 'turno-con-atencion'
  /**
   * 409 `recepcion-transicion-no-permitida`: el estado de la RECEPCION no admite esa transicion
   * (AKINE E-4, DP-16). Viaja con `motivo`. Distinto del de turno: lo que quedo viejo es la
   * recepcion, no la reserva.
   */
  | 'recepcion-transicion-no-permitida'
  /** 409 subscription-suspended: lo emite el filtro, antes del controller. */
  | 'suscripcion-suspendida'
  /** Cualquier otro 409. Gana el `detail` del backend. */
  | 'conflicto'
  /** 429: hay que esperar. Ver `segundosDeEspera`. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/**
 * Que puede hacer el usuario a continuacion.
 *
 * <p>Es lo que separa este traductor de los de las otras features: aca el tipo de error no solo
 * elige un texto, elige <b>un boton</b>. La pantalla ramifica por esto y no por la causa, asi que
 * dos causas que se resuelven igual comparten accion sin repetir la rama.
 */
export type AccionSugerida =
  /** Volver a pedir la agenda: lo que se ve en pantalla quedo viejo. */
  | 'recargar-agenda'
  /**
   * Volver a pedir la lista del dia de la recepcion (AKINE-05.04).
   *
   * <p>Tercera variante de "recarga" y no un lujo: son <b>tres lecturas distintas</b>. La agenda
   * son los huecos de una oferta, el turno es una fila con su version, y el dia es la lista de la
   * recepcion. Reusar `recargar-agenda` aca haria que el boton dijera "releer la agenda" en una
   * pantalla que no muestra ninguna.
   */
  | 'recargar-dia'
  /** Ofrecer el siguiente slot del mismo dia: el horario existe, lo que falta es cupo. */
  | 'ofrecer-siguiente'
  /** Volver al buscador a elegir otro horario o profesional. */
  | 'elegir-otro'
  /** Ir al padron a activar el perfil de paciente. */
  | 'activar-perfil'
  /**
   * Volver a leer el historial del turno: lo que la pantalla muestra quedo viejo.
   *
   * <p>Distinta de `recargar-agenda` porque recarga <b>otra cosa</b>. La agenda son los huecos de
   * una oferta; el turno es una fila con su propia version, y es la version la que quedo vieja.
   */
  | 'recargar-turno'
  /**
   * Ir a la atencion clinica de ese turno. La transicion administrativa no se destraba sola.
   *
   * <p>Es la unica accion honesta ante `turno-con-atencion`: la Sesion existe y hay que resolverla
   * ahi. Reintentar la cancelacion mil veces devuelve el mismo 409.
   */
  | 'resolver-atencion'
  /** Reintentar el mismo pedido con una clave de idempotencia nueva. */
  | 'reintentar-con-clave-nueva'
  /** Elegir contexto de trabajo. */
  | 'elegir-contexto'
  /** Nada que la pantalla pueda ofrecer: solo mostrar el mensaje. */
  | 'ninguna';

/** Error ya traducido a algo mostrable, con la accion que lo resuelve. */
export interface ErrorAgenda {
  readonly mensaje: string;
  readonly causa: CausaAgenda;
  readonly accion: AccionSugerida;
  /** Segundos a esperar antes de reintentar. 0 fuera de `limite`. */
  readonly segundosDeEspera: number;
  /** Ancho maximo de ventana que acepta el backend. 0 fuera de `ventana-demasiado-amplia`. */
  readonly maxDias: number;
  /** Cupo total del slot lleno. 0 fuera de `slot-completo`. */
  readonly cupoTotal: number;
  /** `'profesional'` o `'espacio'`. Vacio fuera de `recurso-ocupado`. */
  readonly recurso: string;
  /** Que cambio desde que se dibujo la grilla. Vacio fuera de `slot-no-disponible`. */
  readonly motivo: string;
}

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
const MENSAJE_LIMITE_SIN_PLAZO =
  'Demasiados intentos. Espera un momento antes de volver a intentar.';

const MENSAJE_SIN_CONTEXTO =
  'Para ver la agenda hay que saber en que centro estas. Eligi una organizacion y un consultorio, ' +
  'y volve a entrar. Tu sesion sigue abierta.';

const MENSAJE_SIN_PERMISO =
  'No tenes permiso para consultar o reservar turnos en esta sede. Pediselo a quien administra el ' +
  'centro.';

const MENSAJE_NO_ENCONTRADO =
  'Eso ya no existe, o no es de esta sede. Volve al buscador y elegi una oferta del listado ' +
  'actual.';

const MENSAJE_OFERTA_NO_AGENDABLE =
  'Esta oferta no se puede agendar: esta dada de baja, o su vigencia no toca las fechas que ' +
  'pediste. Elegi otra oferta, u otro rango de fechas.';

const MENSAJE_SLOT_NO_DISPONIBLE =
  'Ese horario dejo de estar disponible mientras lo mirabas. No reservamos nada. Recarga la ' +
  'agenda para ver los horarios que quedan.';

const MENSAJE_SLOT_COMPLETO =
  'Ese horario se lleno mientras lo mirabas. El horario sigue existiendo, lo que se agoto es el ' +
  'cupo: probá con el turno siguiente.';

const MENSAJE_RECURSO_OCUPADO =
  'Ya hay otro turno que se cruza con este intervalo. Elegi otro horario, o el mismo horario con ' +
  'otro profesional.';

const MENSAJE_SIN_PERFIL_PACIENTE =
  'Esa persona todavia no tiene perfil de paciente, asi que no se le puede reservar una atencion. ' +
  'Activaselo desde el padron y volve: no hay que volver a cargar ningun dato.';

/**
 * La clave de idempotencia se reuso con otro contenido.
 *
 * <p>Se lo dice al usuario sin culparlo y sin jerga inutil: no hizo nada mal y no hay nada que
 * corregir en el formulario. Lo unico que resuelve es empezar el intento con una clave nueva.
 */
const MENSAJE_CLAVE_REUSADA =
  'Hubo un problema tecnico con este intento de reserva: la clave que lo identifica ya se habia ' +
  'usado para otro pedido distinto. No se reservo nada y no es un error tuyo. Volve a intentarlo: ' +
  'arrancamos el intento de cero.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripcion de la organizacion esta suspendida, asi que no se pueden reservar turnos. Se ' +
  'resuelve desde la pantalla de suscripcion.';

/**
 * El ciclo del turno no admite la operacion.
 *
 * <p>El texto del backend viaja en `motivo` —"ya esta cancelado", "ya empezo y no se puede
 * mover"— y la pantalla lo muestra debajo. Sin el, este mensaje seria un "no se puede" sin decir
 * por que, que es exactamente lo que el tipo propio existe para evitar.
 */
const MENSAJE_TRANSICION_NO_PERMITIDA =
  'Este turno no admite esa operacion en su estado actual. Volve a leer su historial: puede que ' +
  'otra persona lo haya cambiado, o que ya haya pasado su hora.';

/**
 * El turno tiene una Sesion registrada.
 *
 * <p>Es el mensaje que la etapa pidio explicitamente que no fuera un "error inesperado": el
 * operador tiene que entender que <b>hay una atencion clinica</b> y que el turno no se toca hasta
 * resolverla. DP-05 mantiene las dos maquinas de estado separadas y ninguna operacion
 * administrativa puede borrar la prueba de que la atencion ocurrio.
 */
const MENSAJE_TURNO_CON_ATENCION =
  'Este turno ya tiene una atencion clinica registrada, asi que no se puede cancelar, reprogramar ' +
  'ni marcar como ausente: eso borraria la prueba de que la atencion ocurrio. Si la atencion se ' +
  'abrio por error, resolvela desde la pantalla de atencion clinica.';

const MENSAJE_CONFLICTO =
  'El servidor rechazo la operacion por un conflicto con lo que ya hay guardado. Recarga la ' +
  'agenda para ver el estado actual.';

/** Traduce cualquier error de las dos pantallas de agenda. */
export function traducirErrorAgenda(error: unknown): ErrorAgenda {
  if (!(error instanceof AkineHttpError)) {
    return base(MENSAJE_GENERICO, 'otro', 'ninguna');
  }

  if (error.esDeRed) {
    return base(MENSAJE_DE_RED, 'red', 'ninguna');
  }

  if (error.esRateLimited) {
    const segundos = segundosDeEspera(error);
    return {
      ...base(
        segundos > 0
          ? `Demasiados intentos. Espera ${segundos} segundos y volve a intentar.`
          : MENSAJE_LIMITE_SIN_PLAZO,
        'limite',
        'ninguna',
      ),
      segundosDeEspera: segundos,
    };
  }

  switch (error.problemType) {
    case 'missing-tenant-context':
      return base(MENSAJE_SIN_CONTEXTO, 'sin-contexto', 'elegir-contexto');
    case 'subscription-suspended':
      return base(MENSAJE_SUSCRIPCION_SUSPENDIDA, 'suscripcion-suspendida', 'ninguna');
    case 'ventana-demasiado-amplia':
      return {
        ...base(mensajeDeVentana(error), 'ventana-demasiado-amplia', 'recargar-agenda'),
        maxDias: error.numeroDeExtension('maxDays') ?? 0,
      };
    case 'slot-no-disponible':
      return {
        ...base(MENSAJE_SLOT_NO_DISPONIBLE, 'slot-no-disponible', 'recargar-agenda'),
        motivo: textoDeExtension(error, 'motivo'),
      };
    case 'slot-completo':
      return {
        ...base(MENSAJE_SLOT_COMPLETO, 'slot-completo', 'ofrecer-siguiente'),
        cupoTotal: error.numeroDeExtension('cupoTotal') ?? 0,
      };
    case 'recurso-ocupado':
      return {
        ...base(MENSAJE_RECURSO_OCUPADO, 'recurso-ocupado', 'elegir-otro'),
        recurso: textoDeExtension(error, 'recurso'),
      };
    case 'persona-sin-perfil-paciente':
      return base(MENSAJE_SIN_PERFIL_PACIENTE, 'persona-sin-perfil-paciente', 'activar-perfil');
    case 'idempotency-key-conflict':
      return base(MENSAJE_CLAVE_REUSADA, 'clave-reusada', 'reintentar-con-clave-nueva');
    case 'turno-transicion-no-permitida':
      return {
        ...base(MENSAJE_TRANSICION_NO_PERMITIDA, 'turno-transicion-no-permitida', 'recargar-turno'),
        motivo: textoDeExtension(error, 'motivo'),
      };
    case 'recepcion-transicion-no-permitida':
      return {
        ...base(
          MENSAJE_RECEPCION_NO_PERMITIDA,
          'recepcion-transicion-no-permitida',
          'recargar-dia',
        ),
        motivo: textoDeExtension(error, 'motivo'),
      };
    case 'turno-con-atencion':
      return base(MENSAJE_TURNO_CON_ATENCION, 'turno-con-atencion', 'resolver-atencion');
    case 'oferta-inactiva':
    // Las dos dicen lo mismo para quien mira la agenda: esta oferta no se puede agendar.
    // falls through
    case 'oferta-no-agendable':
      return base(MENSAJE_OFERTA_NO_AGENDABLE, 'oferta-no-agendable', 'ninguna');
    default:
      break;
  }

  if (error.status === 403) {
    return base(MENSAJE_SIN_PERMISO, 'sin-permiso', 'ninguna');
  }

  if (error.status === 404) {
    // Inexistente y de otro tenant responden igual a proposito: distinguirlos permitiria
    // enumerar sedes ajenas probando ids.
    return base(MENSAJE_NO_ENCONTRADO, 'no-encontrado', 'recargar-agenda');
  }

  if (error.status === 409) {
    return base(conDetalle(error, MENSAJE_CONFLICTO), 'conflicto', 'recargar-agenda');
  }

  if (error.status === 400) {
    return base(conDetalle(error, MENSAJE_GENERICO), 'validacion', 'ninguna');
  }

  return base(conDetalle(error, MENSAJE_GENERICO), 'otro', 'ninguna');
}

/**
 * El turno ya no admite una llegada: esta cancelado o marcado ausente (AKINE E-4).
 *
 * <p>Con DP-16 este tipo solo lo devuelve el check-in: las demas transiciones del mostrador son de
 * la recepcion y tienen su propio tipo. El detalle del servidor viaja en `motivo`.
 */
const MENSAJE_LLEGADA_NO_APLICABLE =
  'Ese turno ya no admite registrar una llegada: puede que otra persona lo haya cancelado o ' +
  'marcado ausente desde otro puesto. Actualizamos la fila con lo que dice el servidor.';

/**
 * La recepcion no admite esa transicion en su estado actual (AKINE E-4, DP-16).
 *
 * <p>El caso tipico es el que la etapa 05.04 ya conocia con otro nombre: <b>anular no es
 * idempotente</b>. Registrar la llegada dos veces no es problema, pero anular lo ya anulado, o
 * llamar a alguien que otro puesto ya llamo, responde 409. El texto explica la asimetria en vez de
 * disculparse, y la fila se relee sola.
 */
const MENSAJE_RECEPCION_NO_PERMITIDA =
  'La recepcion de ese turno ya no esta en el estado que esa accion necesita. Registrar la ' +
  'llegada dos veces no es un problema —es idempotente—, pero anular, llamar o pasar a espera ' +
  'si: puede que otra persona ya lo haya hecho desde otro puesto. Actualizamos la fila con lo ' +
  'que dice el servidor.';

/**
 * Traduce los errores de la <b>recepcion del dia</b> (M13, AKINE-05.04).
 *
 * <p>Delega en {@link traducirErrorAgenda}, que ya cubre los `problemType` que estas cuatro
 * operaciones pueden devolver, y corrige las <b>dos cosas que en esta pantalla estarian mal</b>:
 *
 * <ol>
 *   <li><b>El texto de `turno-transicion-no-permitida`.</b> El de la agenda manda a "releer el
 *       historial", que en la recepcion no se ve. Aca el caso concreto es el check-in, y el
 *       mensaje lo nombra.</li>
 *   <li><b>La accion.</b> Todo lo que alla resolvia recargando la agenda o el turno, aca se
 *       resuelve recargando <b>el dia</b>, que es lo unico que esta pantalla sabe pedir. Un boton
 *       que ofrezca recargar algo que no esta en pantalla es peor que no ofrecer nada.</li>
 * </ol>
 *
 * <p>Todo lo demas —red, 429, sin contexto, sin permiso, 404, suscripcion suspendida— pasa tal
 * cual: no cambia de significado por estar en otra pantalla, y duplicar esos textos garantizaria
 * que un dia digan cosas distintas.
 */
export function traducirErrorRecepcion(error: unknown): ErrorAgenda {
  const traducido = traducirErrorAgenda(error);

  if (traducido.causa === 'turno-transicion-no-permitida') {
    return { ...traducido, mensaje: MENSAJE_LLEGADA_NO_APLICABLE, accion: 'recargar-dia' };
  }

  // Los dos que llegan aca con `recargar-agenda`: el 404 —el turno se borro, o la sede es de otro
  // tenant— y cualquier 409 sin tipo propio, que incluye el `conflict` generico al que el handler
  // global mapea la version vieja.
  if (traducido.accion === 'recargar-agenda') {
    return { ...traducido, accion: 'recargar-dia' };
  }

  return traducido;
}

/**
 * Ventana recortada al maximo que el backend acepta.
 *
 * <p>Devuelve el nuevo `hasta` <b>exclusivo</b>: `desde` + `maxDias`. Es lo que convierte el 400
 * en una accion en vez de un cartel — la pantalla reintenta sola con la ventana que si entra.
 *
 * <p>Con `maxDias` en cero o negativo devuelve `null`: sin el numero no hay nada que recortar y
 * inventar un ancho seria adivinar la regla del servidor.
 */
export function recortarVentana(desde: string, maxDias: number): string | null {
  if (!Number.isFinite(maxDias) || maxDias <= 0) {
    return null;
  }
  const inicio = new Date(`${desde}T00:00:00Z`);
  if (Number.isNaN(inicio.getTime())) {
    return null;
  }
  inicio.setUTCDate(inicio.getUTCDate() + Math.floor(maxDias));
  return inicio.toISOString().slice(0, 10);
}

function mensajeDeVentana(error: AkineHttpError): string {
  const maximo = error.numeroDeExtension('maxDays');
  return maximo === null
    ? 'El rango de fechas es demasiado amplio. Pedi menos dias.'
    : `El rango de fechas era demasiado amplio: la agenda se consulta de a ${maximo} dias como ` +
        'maximo. Lo recortamos y volvimos a pedirla.';
}

function base(mensaje: string, causa: CausaAgenda, accion: AccionSugerida): ErrorAgenda {
  return {
    mensaje,
    causa,
    accion,
    segundosDeEspera: 0,
    maxDias: 0,
    cupoTotal: 0,
    recurso: '',
    motivo: '',
  };
}

/**
 * Extension de texto, o cadena vacia.
 *
 * <p>`extension()` devuelve `unknown` a proposito: el contrato no tipa estas claves. Validar en
 * vez de confiar evita que un `motivo` numerico termine impreso como `[object Object]`.
 */
function textoDeExtension(error: AkineHttpError, clave: string): string {
  const valor = error.extension(clave);
  return typeof valor === 'string' ? valor : '';
}

/** El mensaje del backend, o el de respaldo si el cuerpo no traia `ProblemDetail`. */
function conDetalle(error: AkineHttpError, respaldo: string): string {
  return error.problem === null ? respaldo : error.mensaje;
}

/** Espera declarada en `Retry-After`, o `0`. Sin header no se inventa un numero. */
function segundosDeEspera(error: AkineHttpError): number {
  const segundos = error.reintentarEnSegundos;
  if (segundos === null || !Number.isFinite(segundos) || segundos <= 0) {
    return 0;
  }
  return Math.ceil(segundos);
}
