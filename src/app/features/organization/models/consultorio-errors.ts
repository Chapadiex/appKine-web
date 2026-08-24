import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Motivo por el que fallo una operacion sobre sedes (M01, AKINE-02.01).
 *
 * <p>Se ramifica por `problemType` y nunca por el texto de `detail`: ese campo es prosa
 * para humanos y cambia cuando alguien corrige una redaccion. Un
 * `if (mensaje.includes('ultima sede'))` se rompe con una tilde.
 *
 * <p><b>No importa nada de `features/auth`.</b> Un feature no importa de otro (AGENT.md
 * seccion 4). Tampoco se fusiona con `colaborador-errors.ts`, que es del mismo feature pero
 * de otro dominio: aca los `409` son cinco invariantes distintos que alla no existen, y dos
 * de ellos -el tope del plan y la ultima sede activa- necesitan un texto propio que no se
 * puede escribir de forma generica.
 */
export type CausaConsultorio =
  /** 403 missing-tenant-context: hay sesion pero no se eligio contexto. */
  | 'sin-contexto'
  /** 403 forbidden: falta `consultorio:manage` en este contexto. */
  | 'sin-permiso'
  /** 400 validation-error: zona no IANA, motivo vacio, campos fuera de forma. */
  | 'validacion'
  /** 404: la sede o la organizacion no existe, o es de otro tenant. */
  | 'no-encontrado'
  /** 409 plan-limit-exceeded: el plan no permite otra sede. */
  | 'tope-del-plan'
  /** 409 last-consultorio-required: es la unica sede activa. */
  | 'ultima-sede'
  /** 409 concurrent-modification: la `version` enviada quedo vieja. Hay que releer. */
  | 'concurrencia'
  /** 409 idempotency-key-conflict: misma clave de intento con otro cuerpo. */
  | 'clave-repetida'
  /** 409 consultorio-has-active-references: hay cosas vivas que dependen de la sede. */
  | 'con-referencias'
  /** 403 feature-not-available: la funcion no esta en el plan contratado. */
  | 'fuera-del-plan'
  /** 409: el resto de los invariantes -nombre tomado, sede inactiva, suscripcion-. */
  | 'conflicto'
  /** 429: hay que esperar. Ver `segundosDeEspera`. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/** Error ya traducido a algo mostrable. */
export interface ErrorConsultorio {
  readonly mensaje: string;
  readonly causa: CausaConsultorio;
  /** Segundos a esperar antes de reintentar. 0 fuera de `limite`, y 0 en un 429 sin header. */
  readonly segundosDeEspera: number;
}

/** Textos que cada pantalla sobreescribe sin reimplementar el mapeo. */
export interface TextosConsultorio {
  /** Que significa un 404 en esta pantalla. */
  readonly noEncontrado?: string;
  readonly generico?: string;
}

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
const MENSAJE_SIN_CONTEXTO = 'Todavia no elegiste un contexto de trabajo.';
const MENSAJE_SIN_PERMISO =
  'No tenes permiso para administrar las sedes de esta organizacion. Pediselo a quien la administra.';
const MENSAJE_LIMITE_SIN_PLAZO =
  'Demasiados intentos. Espera un momento antes de volver a intentar.';

/**
 * La sede no se puede dar de baja porque algo vivo depende de ella.
 *
 * <p>Es el unico 409 del modulo donde lo accionable **no** esta en esta pantalla: hay que ir a
 * resolver lo que bloquea. Por eso se nombra que es y cuanto hay -`referenceType` y
 * `referenceCount` viajan en el cuerpo del problema- en lugar de decir "conflicto": la
 * diferencia entre "no se pudo" y "hay 14 turnos futuros en esa sede" es la diferencia entre
 * llamar a soporte y resolverlo solo.
 *
 * <p>El backend todavia no lo emite -la sonda de referencias queda reservada para F5, cuando
 * existan los turnos- pero el codigo esta declarado en el contrato y el dia que empiece a
 * llegar tiene que encontrar un mensaje util, no la rama generica.
 */
function mensajeDeReferenciasActivas(error: AkineHttpError): string {
  const tipo = error.extension('referenceType');
  const cantidad = error.numeroDeExtension('referenceCount');

  if (typeof tipo === 'string' && cantidad !== null) {
    return (
      `No se puede dar de baja esta sede porque todavia tiene ${cantidad} ` +
      `${tipo} sin resolver. Resolvelos primero y volve a intentar.`
    );
  }
  return (
    'No se puede dar de baja esta sede porque todavia hay operaciones vigentes que dependen ' +
    'de ella. Resolvelas primero y volve a intentar.'
  );
}

/**
 * El plan alcanzo su tope de sedes.
 *
 * <p><b>Este es el error que mas se va a ver de todo el modulo</b>, y por eso no se muestra
 * como un conflicto tecnico. El plan `BASICO` -el que queda contratado en el alta
 * self-service- permite una sola sede, asi que cualquier centro que crezca choca con esto en
 * su primer intento de abrir la segunda. No es una falla: es el limite de lo que contrato, y
 * lo unico accionable es cambiar de plan.
 *
 * <p>Se usan `limitValue` y `currentUsage` del cuerpo del problema porque "tu plan incluye
 * hasta 1 sede y ya tenes 1" responde sola la pregunta siguiente; un "conflicto" a secas deja
 * al usuario sin saber si el problema es lo que escribio.
 */
function mensajeDeTopeDelPlan(error: AkineHttpError): string {
  const tope = error.numeroDeExtension('limitValue');
  const enUso = error.numeroDeExtension('currentUsage');

  if (tope === 1) {
    return (
      'Tu plan actual incluye una sola sede y ya la estas usando. Para abrir otra sede ' +
      'necesitas cambiar a un plan que incluya mas de una: podes hacerlo desde la pantalla ' +
      'de suscripcion. La sede que ya tenes sigue funcionando normalmente.'
    );
  }

  if (tope !== null && enUso !== null) {
    return (
      `Tu plan actual incluye hasta ${tope} sedes y ya tenes ${enUso}. Para abrir otra ` +
      'necesitas cambiar a un plan que incluya mas: podes hacerlo desde la pantalla de ' +
      'suscripcion. Las sedes que ya tenes siguen funcionando normalmente.'
    );
  }

  // Sin los datos del limite se dice lo mismo sin numeros, que sigue siendo accionable.
  return (
    'Tu plan actual no permite abrir otra sede. Para sumar una necesitas cambiar a un plan ' +
    'que incluya mas sedes: podes hacerlo desde la pantalla de suscripcion.'
  );
}

/**
 * Es la ultima sede activa de la organizacion.
 *
 * <p>El backend lo devuelve como un `409`, pero mostrarlo como "conflicto" no le dice nada
 * a quien lo lee: no es que dos personas hicieran algo a la vez, es que la operacion no
 * tiene sentido. El contexto de trabajo de AKINE es Organizacion + Consultorio, asi que una
 * organizacion sin ninguna sede activa no ofreceria ningun contexto y nadie podria entrar a
 * trabajar. El texto lo explica y dice cual es la salida.
 */
const MENSAJE_ULTIMA_SEDE =
  'Esta es la unica sede activa de la organizacion y por eso no se puede dar de baja: una ' +
  'organizacion tiene que conservar al menos una sede donde trabajar, o nadie podria elegir ' +
  'un contexto para entrar. Si estas mudando el centro, primero da de alta la sede nueva y ' +
  'despues da de baja esta.';

const MENSAJE_FUNCION_FUERA_DEL_PLAN =
  'Esta funcion no esta incluida en el plan que tenes contratado. No es un problema de ' +
  'permisos: para usarla hay que cambiar a un plan que la incluya, y eso se hace desde la ' +
  'pantalla de suscripcion.';

const MENSAJE_CONCURRENCIA =
  'Alguien mas edito esta sede mientras la estabas modificando, asi que no guardamos tus ' +
  'cambios para no pisar los suyos. Volvimos a leer los datos actuales: revisalos y confirma ' +
  'de nuevo si seguis queriendo el cambio.';

const MENSAJE_CLAVE_REPETIDA =
  'Cambiaste los datos despues de un intento anterior que quedo a medias. Volve a enviar el ' +
  'alta: se manda como un intento nuevo.';

/**
 * Traduce cualquier error de las pantallas de sedes.
 *
 * <p><b>El `detail` del backend gana</b> donde no hay nada mejor que decir (AGENT.md
 * seccion 8): en `consultorio-name-taken`, `consultorio-inactive` y
 * `subscription-suspended` el texto del servidor es correcto y especifico. Las dos
 * excepciones son `plan-limit-exceeded` y `last-consultorio-required`, donde el frontend
 * conoce el contexto de la pantalla -que hay una pantalla de suscripcion, que se puede dar
 * de alta otra sede primero- y puede decir cual es la salida, cosa que el backend no.
 */
export function traducirErrorConsultorio(
  error: unknown,
  textos: TextosConsultorio = {},
): ErrorConsultorio {
  if (!(error instanceof AkineHttpError)) {
    return { mensaje: textos.generico ?? MENSAJE_GENERICO, causa: 'otro', segundosDeEspera: 0 };
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
    case 'plan-limit-exceeded':
      return { mensaje: mensajeDeTopeDelPlan(error), causa: 'tope-del-plan', segundosDeEspera: 0 };
    case 'last-consultorio-required':
      return { mensaje: MENSAJE_ULTIMA_SEDE, causa: 'ultima-sede', segundosDeEspera: 0 };
    case 'consultorio-has-active-references':
      return {
        mensaje: mensajeDeReferenciasActivas(error),
        causa: 'con-referencias',
        segundosDeEspera: 0,
      };
    case 'concurrent-modification':
      return { mensaje: MENSAJE_CONCURRENCIA, causa: 'concurrencia', segundosDeEspera: 0 };
    case 'idempotency-key-conflict':
      return { mensaje: MENSAJE_CLAVE_REPETIDA, causa: 'clave-repetida', segundosDeEspera: 0 };
    case 'missing-tenant-context':
      return { mensaje: MENSAJE_SIN_CONTEXTO, causa: 'sin-contexto', segundosDeEspera: 0 };
    case 'feature-not-available':
      // Viaja como 403 y sin este caso caia en "no tenes permiso", que manda al usuario a
      // pedirle acceso a su administrador por algo que ningun permiso le va a dar: la funcion
      // no esta en el plan contratado. Son dos salidas distintas -pedir acceso o cambiar de
      // plan- y confundirlas hace perder el tiempo a dos personas.
      return {
        mensaje: MENSAJE_FUNCION_FUERA_DEL_PLAN,
        causa: 'fuera-del-plan',
        segundosDeEspera: 0,
      };
    default:
      break;
  }

  if (error.status === 403) {
    return {
      mensaje: conDetalle(error, MENSAJE_SIN_PERMISO),
      causa: 'sin-permiso',
      segundosDeEspera: 0,
    };
  }

  if (error.status === 404) {
    // Sede inexistente, sede de otro tenant y organizacion de otro tenant responden las tres
    // igual: distinguirlas permitiria enumerar los tenants del SaaS probando ids.
    return {
      mensaje: textos.noEncontrado ?? conDetalle(error, 'No encontramos esa sede.'),
      causa: 'no-encontrado',
      segundosDeEspera: 0,
    };
  }

  if (error.status === 409) {
    // Nombre tomado, sede inactiva, sede ya inactiva y suscripcion suspendida: el `detail`
    // del backend ya explica cual de los cuatro y es lo mas preciso que hay.
    return {
      mensaje: conDetalle(error, MENSAJE_GENERICO),
      causa: 'conflicto',
      segundosDeEspera: 0,
    };
  }

  if (error.status === 400) {
    return {
      mensaje: conDetalle(error, MENSAJE_GENERICO),
      causa: 'validacion',
      segundosDeEspera: 0,
    };
  }

  return { mensaje: conDetalle(error, MENSAJE_GENERICO), causa: 'otro', segundosDeEspera: 0 };
}

/** El mensaje del backend, o el de respaldo si el cuerpo no traia `ProblemDetail`. */
function conDetalle(error: AkineHttpError, respaldo: string): string {
  return error.problem === null ? respaldo : error.message;
}

/**
 * Espera declarada por el backend en `Retry-After`, o `0` si no la mando.
 *
 * <p>Misma decision que en el resto de las pantallas: <b>sin header no se inventa un
 * numero</b>. Un plazo inventado deja al usuario esperando de mas, o le promete que ya
 * puede y se come otro 429.
 */
function segundosDeEspera(error: AkineHttpError): number {
  const segundos = error.reintentarEnSegundos;
  if (segundos === null || !Number.isFinite(segundos) || segundos <= 0) {
    return 0;
  }
  return Math.ceil(segundos);
}
