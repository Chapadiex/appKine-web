import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Motivo por el que fallo una operacion sobre espacios (M04, AKINE-02.02).
 *
 * <p>Se ramifica por `problemType` y <b>nunca</b> por el texto de `detail`: ese campo es
 * prosa para humanos y cambia cuando alguien corrige una redaccion. Los cinco codigos nuevos
 * de la etapa salen del enum `ProblemType` del cliente generado -por eso
 * {@link AkineHttpError.problemType} los reconoce- y no de una lista escrita a mano en este
 * repo, que se desincroniza en silencio.
 *
 * <p><b>No se fusiona con `consultorio-errors.ts`.</b> Son features distintos (AGENT.md 4.4)
 * y ademas ramifican distinto: aca los `409` son seis invariantes que alla no existen, y
 * tres de ellos -nombre tomado, espacio inactivo y capacidad por debajo de la ocupacion-
 * necesitan aterrizar en un <b>campo</b> del formulario, no en un cartel al pie.
 */
export type CausaEspacio =
  /** 403 missing-tenant-context: hay sesion, pero no hay sede elegida. NUNCA cerrar sesion. */
  | 'sin-contexto'
  /** 403 forbidden: falta `consultorio:manage` sobre esta sede. */
  | 'sin-permiso'
  /** 400 validation-error: campos fuera de forma, ventana incoherente, motivo vacio. */
  | 'validacion'
  /** 404: el espacio no existe, es de otra sede o de otro tenant. */
  | 'no-encontrado'
  /** 409 espacio-name-taken: ya hay un espacio VIGENTE con ese nombre en la sede. */
  | 'nombre-tomado'
  /** 409 espacio-inactive: esta dado de baja, no admite ediciones. */
  | 'espacio-inactivo'
  /** 409 espacio-already-inactive: la baja ya estaba hecha. Hay que recargar. */
  | 'ya-inactivo'
  /** 409 concurrent-modification: la `version` enviada quedo vieja. Recargar y reintentar. */
  | 'concurrencia'
  /** 409 consultorio-inactive: la sede esta dada de baja y no origina hechos nuevos. */
  | 'sede-inactiva'
  /** 409 espacio-capacity-below-occupancy: RESERVADO, hoy no llega. */
  | 'capacidad-comprometida'
  /** 409 espacio-has-active-references: RESERVADO, hoy no llega. */
  | 'con-referencias'
  /** 409 subscription-suspended: lo emite el filtro, antes del controller. */
  | 'suscripcion-suspendida'
  /** 429: hay que esperar. Ver `segundosDeEspera`. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/** Error ya traducido a algo mostrable. */
export interface ErrorEspacio {
  readonly mensaje: string;
  readonly causa: CausaEspacio;
  /** Segundos a esperar antes de reintentar. 0 fuera de `limite`. */
  readonly segundosDeEspera: number;
}

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
const MENSAJE_LIMITE_SIN_PLAZO =
  'Demasiados intentos. Espera un momento antes de volver a intentar.';

/**
 * No hay sede elegida.
 *
 * <p><b>Esto no cierra la sesion.</b> El backend responde `403` y la reaccion instintiva
 * -mandar al login- es la equivocada: las credenciales estan bien, lo que falta es el
 * contexto de trabajo. Volver a autenticarse no elige ninguna sede y deja al usuario
 * girando en el mismo bucle.
 */
const MENSAJE_SIN_CONTEXTO =
  'Los espacios son de una sede concreta y todavia no elegiste ninguna. Eligi un consultorio ' +
  'para ver y administrar sus boxes.';

const MENSAJE_SIN_PERMISO =
  'No tenes permiso para administrar los espacios de esta sede. Pediselo a quien la administra.';

const MENSAJE_NO_ENCONTRADO =
  'Ese espacio ya no existe, o pertenece a otra sede. Recarga el listado para ver los que hay ahora.';

/**
 * El nombre ya esta tomado.
 *
 * <p>El detalle que el backend no puede saber que hace falta decir: el unique es entre los
 * espacios <b>vigentes</b>, asi que el nombre de uno dado de baja <b>si</b> se puede reusar.
 * Sin esa aclaracion, quien acaba de dar de baja "Box 2" y quiere volver a crearlo con el
 * mismo nombre lee "ya existe", no ve ningun Box 2 en su listado filtrado por activos, y
 * concluye que la pantalla esta rota.
 */
const MENSAJE_NOMBRE_TOMADO =
  'Ya hay otro espacio vigente en esta sede con ese nombre. Elegi otro. Ojo: el nombre de un ' +
  'espacio dado de baja SI se puede reusar, asi que si el que choca es uno que diste de baja, ' +
  'revisa el filtro "Todos" del listado para ver cual es.';

const MENSAJE_ESPACIO_INACTIVO =
  'Este espacio esta dado de baja y por eso no se puede editar. La baja no se deshace: si el ' +
  'recurso vuelve a estar disponible, dalo de alta como un espacio nuevo.';

const MENSAJE_YA_INACTIVO =
  'Este espacio ya estaba dado de baja, seguramente por otra persona. Recarga el listado para ' +
  'ver el estado actual.';

const MENSAJE_CONCURRENCIA =
  'Alguien mas modifico este espacio mientras lo estabas editando, asi que no guardamos tus ' +
  'cambios para no pisar los suyos. Volvimos a leer los datos actuales: revisalos y confirma ' +
  'de nuevo si seguis queriendo el cambio.';

const MENSAJE_SEDE_INACTIVA =
  'La sede esta dada de baja y no admite espacios nuevos. Lo que ya estaba registrado en ella ' +
  'se conserva, pero no se puede sumar nada.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripcion de la organizacion esta suspendida, asi que no se pueden registrar cambios. ' +
  'Se resuelve desde la pantalla de suscripcion.';

/**
 * La capacidad pedida no alcanza para lo ya comprometido. <b>Codigo reservado.</b>
 *
 * <p>Hoy no llega nunca: no existe ningun modulo que reserve, asi que la ocupacion es
 * siempre cero y toda reduccion procede. El backend lo publico desde ya para que su
 * aparicion -cuando exista la agenda- no sea un cambio de comportamiento sorpresivo, y por
 * eso la pantalla lo trata desde ya. Sin este caso, el dia que empiece a llegar caeria en la
 * rama generica y diria "no pudimos completar la operacion" sobre el unico error del modulo
 * donde el usuario necesita <b>dos numeros</b> para decidir.
 */
function mensajeDeCapacidadComprometida(error: AkineHttpError): string {
  const pedida = error.numeroDeExtension('requestedCapacity');
  const ocupada = error.numeroDeExtension('currentOccupancy');
  const que = error.extension('occupancyType');

  if (pedida !== null && ocupada !== null) {
    const detalle = typeof que === 'string' ? ` (${que})` : '';
    return (
      `No se puede bajar la capacidad a ${pedida}: este espacio ya tiene ${ocupada} lugares ` +
      `comprometidos${detalle}. Lo mas bajo que admite ahora es ${ocupada}. Para reducirla mas, ` +
      'primero hay que liberar esos lugares.'
    );
  }
  return (
    'No se puede bajar la capacidad tanto: este espacio ya tiene mas lugares comprometidos que ' +
    'los que estas pidiendo. Libera esos lugares primero.'
  );
}

/**
 * Hay cosas vigentes que dependen del espacio. <b>Codigo reservado</b>, igual que el anterior.
 *
 * <p>Es el unico `409` del modulo donde lo accionable <b>no</b> esta en esta pantalla: hay
 * que ir a resolver lo que bloquea. Por eso se nombra que es y cuanto hay -`referenceType` y
 * `referenceCount` viajan en el cuerpo- en vez de decir "conflicto": la diferencia entre "no
 * se pudo" y "hay 14 turnos futuros en ese box" es la diferencia entre llamar a soporte y
 * resolverlo solo.
 */
function mensajeDeReferenciasActivas(error: AkineHttpError): string {
  const tipo = error.extension('referenceType');
  const cantidad = error.numeroDeExtension('referenceCount');

  if (typeof tipo === 'string' && cantidad !== null) {
    return (
      `No se puede dar de baja este espacio porque todavia tiene ${cantidad} ${tipo} sin ` +
      'resolver. Resolvelos primero y volve a intentar.'
    );
  }
  return (
    'No se puede dar de baja este espacio porque todavia hay operaciones vigentes que dependen ' +
    'de el. Resolvelas primero y volve a intentar.'
  );
}

/**
 * Traduce cualquier error de las pantallas de espacios.
 *
 * <p><b>El `detail` del backend gana solo donde no hay nada mejor que decir</b> (AGENT.md 8):
 * en `validation-error` el servidor nombra el campo concreto y ningun texto fijo de aca puede
 * superarlo. En los seis `409` del modulo el frontend conoce el contexto de la pantalla -que
 * hay un filtro "Todos", que la baja no se deshace, que la version se relee sola- y puede
 * decir cual es la salida, cosa que el backend no.
 */
export function traducirErrorEspacio(error: unknown): ErrorEspacio {
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
    case 'espacio-name-taken':
      return { mensaje: MENSAJE_NOMBRE_TOMADO, causa: 'nombre-tomado', segundosDeEspera: 0 };
    case 'espacio-inactive':
      return { mensaje: MENSAJE_ESPACIO_INACTIVO, causa: 'espacio-inactivo', segundosDeEspera: 0 };
    case 'espacio-already-inactive':
      return { mensaje: MENSAJE_YA_INACTIVO, causa: 'ya-inactivo', segundosDeEspera: 0 };
    case 'concurrent-modification':
      return { mensaje: MENSAJE_CONCURRENCIA, causa: 'concurrencia', segundosDeEspera: 0 };
    case 'consultorio-inactive':
      return { mensaje: MENSAJE_SEDE_INACTIVA, causa: 'sede-inactiva', segundosDeEspera: 0 };
    case 'espacio-capacity-below-occupancy':
      return {
        mensaje: mensajeDeCapacidadComprometida(error),
        causa: 'capacidad-comprometida',
        segundosDeEspera: 0,
      };
    case 'espacio-has-active-references':
      return {
        mensaje: mensajeDeReferenciasActivas(error),
        causa: 'con-referencias',
        segundosDeEspera: 0,
      };
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
    // Espacio inexistente, de otra sede y de otro tenant responden los tres igual:
    // distinguirlos permitiria enumerar los recursos del SaaS probando ids.
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

/**
 * `true` si el error corresponde al campo <b>nombre</b> del formulario.
 *
 * <p>Lo usan las dos pantallas que tienen ese campo para poner el mensaje <b>en el campo</b>
 * -con `aria-invalid` y `aria-describedby`- en vez de al pie: un conflicto de nombre unico es
 * un error de un campo concreto, y mostrarlo lejos obliga al usuario a adivinar cual corregir.
 */
export function esErrorDelNombre(causa: CausaEspacio | null): boolean {
  return causa === 'nombre-tomado';
}

/** El mensaje del backend, o el de respaldo si el cuerpo no traia `ProblemDetail`. */
function conDetalle(error: AkineHttpError, respaldo: string): string {
  return error.problem === null ? respaldo : error.message;
}

/**
 * Espera declarada por el backend en `Retry-After`, o `0` si no la mando.
 *
 * <p>Misma decision que en el resto de las pantallas: sin header <b>no se inventa un
 * numero</b>. Un plazo inventado deja al usuario esperando de mas, o le promete que ya puede
 * y se come otro `429`.
 */
function segundosDeEspera(error: AkineHttpError): number {
  const segundos = error.reintentarEnSegundos;
  if (segundos === null || !Number.isFinite(segundos) || segundos <= 0) {
    return 0;
  }
  return Math.ceil(segundos);
}
