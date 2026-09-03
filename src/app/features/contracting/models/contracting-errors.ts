import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Motivo por el que fallo una operacion de contratacion (M15 y M16, AKINE-03.03 y 03.05).
 *
 * <p>Se ramifica por `problemType` y <b>nunca</b> por el texto de `detail`, por lo mismo que en
 * `offering`, en `catalog` y en `resource`: `detail` es prosa y cambia cuando alguien corrige una
 * redaccion. Un `switch` sobre prosa se rompe sin fallar en ningun lado.
 *
 * <h2>Un solo traductor para las cuatro entidades, y por que</h2>
 *
 * <p>Financiador, plan, convenio y arancel comparten el <b>mismo</b> vocabulario de errores —el
 * backend los emite desde el mismo modulo `contracting`— y la unica diferencia real entre ellos
 * es <b>a que hay que volver</b> cuando la fila ya no esta: al catalogo de financiadores, a los
 * planes de ese financiador, a los convenios de la sede o a la grilla de aranceles. Eso es lo que
 * expresa {@link AmbitoContracting}, y es lo unico que ramifica por entidad.
 *
 * <p>Escribir cuatro traductores casi identicos es como nacen las divergencias silenciosas: uno
 * reconoce `arancel-solapado` y el otro no, y la pantalla que se olvido muestra un generico
 * justo en el unico caso donde habia algo concreto que explicar.
 *
 * <h2>Los `problemType` NO se inventan: estan en el contrato</h2>
 *
 * <p>Los once que se reconocen aca salen del enumerado `ProblemType` del cliente generado, que
 * es lo unico que `AkineHttpError.problemType` sabe resolver: un tipo que no este en ese
 * enumerado vuelve como `null`, asi que un codigo escrito de memoria <b>no falla</b>, cae en la
 * rama por defecto y esconde para siempre el mensaje que deberia mostrar.
 *
 * <h2>El 409 de concurrencia llega como `conflict`, NO como `concurrent-modification`</h2>
 *
 * <p>El registro de cierre de 03.05 lo declara: "la version desactualizada sale como `conflict`,
 * igual que en 03.03". `concurrent-modification` lo emite solo `OrganizationProblemHandler`.
 * Ramificar unicamente por ese tipo daria una rama muerta. Se reconocen <b>los dos</b> por si
 * algun dia se unifican —es una de las decisiones de contrato transversales abiertas del
 * workspace—, pero la rama que hoy se ejercita es `conflict`.
 */
export type CausaContracting =
  /** 403 missing-tenant-context: hay sesion, pero no hay sede elegida. NUNCA cerrar sesion. */
  | 'sin-contexto'
  /** 403: falta `convenio:manage`. Se evalua con la SEDE del contexto, aun para el financiador. */
  | 'sin-permiso'
  /** 400 validation-error. El backend nombra el campo, y su mensaje gana. */
  | 'validacion'
  /** 404: no existe, o es de otro tenant. Los dos responden igual a proposito. */
  | 'no-encontrado'
  /** 409 conflict: la `expectedVersion` enviada quedo vieja. Ver el javadoc de arriba. */
  | 'concurrencia'
  /** 409 subscription-suspended: lo emite el filtro, antes del controller. */
  | 'suscripcion-suspendida'
  /** 409 *-codigo-taken: el codigo ya lo usa otra fila VIGENTE del mismo alcance. */
  | 'codigo-repetido'
  /** 409 *-nombre-taken: idem con el nombre. */
  | 'nombre-repetido'
  /** 409 financiador-cuit-taken: el CUIT normalizado a 11 digitos ya esta. */
  | 'cuit-repetido'
  /**
   * 409 *-solapado: hay otra fila activa que cubre parte del mismo periodo (RN-M16-002).
   *
   * <p>Es la unica causa cuya salida NO es reintentar ni recargar: hay que <b>cerrar la vigencia
   * del que ya esta</b> antes de crear el nuevo.
   */
  | 'solapamiento'
  /** 409 *-inactivo: la fila —o algo de lo que depende— esta dada de baja y no admite lo nuevo. */
  | 'referencia-inactiva'
  /** 409 *-already-inactive: la baja ya se hizo. No es un fallo del usuario. */
  | 'ya-dada-de-baja'
  /** Cualquier otro 409. Gana el `detail` del backend, que nombra el conflicto concreto. */
  | 'conflicto'
  /** 429: hay que esperar. Ver `segundosDeEspera`. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/** Error ya traducido a algo mostrable. */
export interface ErrorContracting {
  readonly mensaje: string;
  readonly causa: CausaContracting;
  /** Segundos a esperar antes de reintentar. 0 fuera de `limite`. */
  readonly segundosDeEspera: number;
}

/**
 * Que se estaba tocando cuando fallo.
 *
 * <p>Cambia <b>una sola rama</b>: el `404`, que tiene que mandar a recargar el listado correcto.
 * El resto de los mensajes es identico para las cuatro entidades, y por eso no hay cuatro
 * traductores.
 */
export type AmbitoContracting = 'financiador' | 'plan' | 'convenio' | 'arancel';

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
const MENSAJE_LIMITE_SIN_PLAZO =
  'Demasiados intentos. Espera un momento antes de volver a intentar.';

/**
 * `403 missing-tenant-context`.
 *
 * <p>Dice explicitamente que <b>la sesion sigue abierta</b>. Sin esa frase, un cartel rojo sobre
 * un listado vacio se lee como "me echaron", y el usuario vuelve a loguearse para nada.
 */
const MENSAJE_SIN_CONTEXTO =
  'Para administrar financiadores y convenios hay que saber en que sede estas trabajando: los ' +
  'convenios son de una sede, y el permiso se evalua con esa sede aunque el financiador sea de ' +
  'toda la organizacion. Eligi un consultorio y volve a entrar. Tu sesion sigue abierta.';

/**
 * `403` sobre una mutacion.
 *
 * <p>Nombra el permiso en castellano y no como codigo, y aclara que <b>consultar si se puede</b>:
 * las lecturas se autorizan por pertenencia y el listado se sigue viendo, asi que un mensaje que
 * sugiera "no tenes acceso a esto" describiria mal lo que el usuario tiene delante.
 */
const MENSAJE_SIN_PERMISO =
  'No podes modificar la configuracion economica de esta sede: hace falta administrar convenios. ' +
  'Pediselo a quien administra la sede o la organizacion. Consultarla si podes, y por eso el ' +
  'listado se sigue viendo.';

const MENSAJE_NO_ENCONTRADO: Readonly<Record<AmbitoContracting, string>> = {
  financiador:
    'Ese financiador ya no existe, o no es de tu organizacion. Recarga el catalogo para ver los ' +
    'que hay ahora.',
  plan: 'Ese plan ya no existe. Recarga los planes del financiador para ver los que hay ahora.',
  convenio:
    'Ese convenio ya no existe, o no es de esta sede. Recarga el listado para ver los que hay ' +
    'ahora.',
  arancel:
    'Ese arancel ya no existe. Recarga la grilla del convenio para ver los que hay ahora.',
};

/**
 * Concurrencia optimista.
 *
 * <p>Dice las tres cosas que el usuario necesita: que <b>no se guardo nada</b>, que no se perdio
 * el cambio de la otra persona, y que lo que sigue es releer y volver a decidir. Un reintento
 * automatico seria justamente pisar lo que el `409` existe para impedir.
 */
const MENSAJE_CONCURRENCIA =
  'Alguien mas modifico esto mientras lo estabas editando, asi que no guardamos tus cambios para ' +
  'no pisar los suyos. Volvimos a leer los datos actuales: revisalos y confirma de nuevo si ' +
  'seguis queriendo el cambio.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripcion de la organizacion esta suspendida, asi que no se pueden registrar cambios. Se ' +
  'resuelve desde la pantalla de suscripcion.';

/**
 * El codigo repetido, con la mitad que el backend no puede decir.
 *
 * <p>El codigo es unico <b>entre los vigentes</b>: el de una fila dada de baja se puede reusar.
 * Sin esa aclaracion, quien acaba de dar de baja un financiador y quiere volver a cargarlo con el
 * mismo codigo lee "ya existe" y concluye que el sistema no lo dejo borrar.
 */
const MENSAJE_CODIGO_REPETIDO =
  'Ese codigo ya lo usa otra ficha vigente. El codigo identifica esta ficha para siempre —no se ' +
  'puede cambiar despues, porque es lo que los historicos guardan—, asi que elegi otro. El codigo ' +
  'de una ficha dada de baja si se puede reusar.';

const MENSAJE_NOMBRE_REPETIDO =
  'Ese nombre ya lo usa otra ficha vigente. A diferencia del codigo, el nombre si se puede ' +
  'cambiar despues: si la otra ficha esta mal nombrada, corregila y volve a intentar.';

const MENSAJE_CUIT_REPETIDO =
  'Ese CUIT ya lo tiene otro financiador vigente. Se compara normalizado a 11 digitos, asi que ' +
  '30-12345678-9 y 30123456789 son el mismo. Si son dos entidades distintas, dejalo vacio: varios ' +
  'financiadores sin CUIT conviven sin chocar.';

/**
 * El solapamiento de periodos, que es la regla central de M16.
 *
 * <p>Es el unico mensaje que <b>ensena una operacion distinta</b>: la salida no es reintentar ni
 * recargar, sino cerrar la vigencia del que ya esta —que es el PUT, no la baja— y recien despues
 * crear el nuevo. Sin esa frase, renovar un convenio parece imposible.
 */
const MENSAJE_SOLAPAMIENTO =
  'Ya hay otro periodo activo que se pisa con el que estas cargando, y dos periodos del mismo ' +
  'alcance no pueden convivir. Si lo que queres es renovar, primero cerra la vigencia del que ya ' +
  'esta —editandolo y poniendole fecha de fin, que no es lo mismo que darlo de baja— y despues ' +
  'carga el nuevo desde el dia siguiente.';

/**
 * Algo de la cadena esta dado de baja.
 *
 * <p>Explica la contracara de que la baja <b>no cascadee</b>: lo que ya existe sigue valiendo y
 * lo unico que se impide es lo nuevo. Es la mitad que un "409" pelado nunca comunica, y la que
 * evita el reporte de bug "di de baja la obra social y sus convenios siguen cobrando".
 */
const MENSAJE_REFERENCIA_INACTIVA =
  'Algo de lo que esto depende esta dado de baja, y una ficha dada de baja no admite altas nuevas ' +
  'ni ediciones. Lo que ya estaba cargado sigue valiendo —dar de baja nunca borra ni cascadea—: ' +
  'lo unico que se impide es lo nuevo. Si hace falta volver a operar con ella, se da de alta otra ' +
  'ficha; no hay reactivacion.';

const MENSAJE_YA_DADA_DE_BAJA =
  'Esto ya estaba dado de baja, asi que no hay nada que hacer. Recarga el listado para verlo con ' +
  'su estado actual.';

const MENSAJE_CONFLICTO =
  'El servidor rechazo el cambio por un conflicto con lo que ya hay guardado. Recarga el listado ' +
  'para ver el estado actual y volve a intentar.';

/**
 * Traduce cualquier error de las pantallas de `contracting`.
 *
 * <p><b>El `detail` del backend gana donde no hay nada mejor que decir</b>: en `validation-error`
 * el servidor nombra el campo, y en los `409` sin tipo propio nombra el conflicto concreto. Donde
 * el frontend sabe algo que el backend no —que existe la operacion de cerrar vigencia, que la
 * baja no cascadea, que la sesion sigue abierta— escribe el suyo.
 */
export function traducirErrorContracting(
  error: unknown,
  ambito: AmbitoContracting,
): ErrorContracting {
  if (!(error instanceof AkineHttpError)) {
    return base(MENSAJE_GENERICO, 'otro');
  }

  if (error.esDeRed) {
    return base(MENSAJE_DE_RED, 'red');
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
      return base(MENSAJE_SIN_CONTEXTO, 'sin-contexto');
    case 'subscription-suspended':
      return base(MENSAJE_SUSCRIPCION_SUSPENDIDA, 'suscripcion-suspendida');
    case 'conflict':
    // `concurrent-modification` no lo emite `contracting` hoy. Se reconoce igual por si algun
    // dia se unifican los dos tipos: ver el javadoc de `CausaContracting`.
    // falls through
    case 'concurrent-modification':
      return base(MENSAJE_CONCURRENCIA, 'concurrencia');

    case 'financiador-codigo-taken':
    case 'plan-cobertura-codigo-taken':
    case 'convenio-codigo-taken':
      return base(MENSAJE_CODIGO_REPETIDO, 'codigo-repetido');

    case 'financiador-nombre-taken':
    case 'plan-cobertura-nombre-taken':
      return base(MENSAJE_NOMBRE_REPETIDO, 'nombre-repetido');

    case 'financiador-cuit-taken':
      return base(MENSAJE_CUIT_REPETIDO, 'cuit-repetido');

    case 'convenio-solapado':
    case 'arancel-solapado':
      return base(MENSAJE_SOLAPAMIENTO, 'solapamiento');

    case 'financiador-inactivo':
    case 'plan-cobertura-inactivo':
    case 'convenio-inactivo':
    case 'arancel-inactivo':
      return base(conDetalle(error, MENSAJE_REFERENCIA_INACTIVA), 'referencia-inactiva');

    case 'financiador-already-inactive':
    case 'plan-cobertura-already-inactive':
    case 'convenio-already-inactive':
    case 'arancel-already-inactive':
      return base(MENSAJE_YA_DADA_DE_BAJA, 'ya-dada-de-baja');

    default:
      break;
  }

  if (error.status === 403) {
    return base(MENSAJE_SIN_PERMISO, 'sin-permiso');
  }

  if (error.status === 404) {
    // Inexistente y de otro tenant responden igual: distinguirlos permitiria enumerar las
    // fichas ajenas probando ids.
    return base(MENSAJE_NO_ENCONTRADO[ambito], 'no-encontrado');
  }

  if (error.status === 409) {
    return base(conDetalle(error, MENSAJE_CONFLICTO), 'conflicto');
  }

  if (error.status === 400) {
    return base(conDetalle(error, MENSAJE_GENERICO), 'validacion');
  }

  return base(conDetalle(error, MENSAJE_GENERICO), 'otro');
}

/**
 * `true` cuando lo unico que resuelve el error es releer el listado.
 *
 * <p><b>El solapamiento NO entra</b>, y es la diferencia que importa: recargar no lo arregla,
 * porque el periodo que choca sigue estando ahi. Ofrecer "Recargar" ante un solapamiento manda
 * al usuario a apretar un boton que no cambia nada.
 */
export function hayQueRecargar(causa: CausaContracting | null): boolean {
  return causa === 'no-encontrado' || causa === 'conflicto' || causa === 'ya-dada-de-baja';
}

function base(mensaje: string, causa: CausaContracting): ErrorContracting {
  return { mensaje, causa, segundosDeEspera: 0 };
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
