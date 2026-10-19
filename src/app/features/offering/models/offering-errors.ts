import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Motivo por el que fallo una operacion sobre servicios u ofertas (M27, AKINE-02.06).
 *
 * <p>Se ramifica por `problemType` y <b>nunca</b> por el texto de `detail`, por lo mismo que
 * en espacios y en el catalogo clinico: `detail` es prosa y cambia cuando alguien corrige una
 * redaccion.
 *
 * <h2>El 409 de concurrencia llega como `concurrent-modification` (DP-21)</h2>
 *
 * <p>Desde el contrato 0.80.0 toda version vieja responde `concurrent-modification` en todos
 * los modulos -el handler global mapea asi el `OptimisticLockingFailureException`- y
 * `conflict` queda solo para conflictos de negocio. Un `conflict` ya no manda a recargar por
 * concurrencia: cae en {@link CausaOffering `conflicto`}, con el `detail` del servidor.
 *
 * <h2>Los 409 sin tipo propio caen en `conflicto`</h2>
 *
 * <p>El codigo y el nombre de servicio repetidos, el servicio dado de baja y la baja ya hecha
 * tienen tipo publicado y causa propia. Lo que no lo tiene <b>no se inventa</b>: un
 * `problemType` escrito de memoria no falla en ningun lado, cae en la rama por defecto y esconde
 * para siempre el mensaje que deberia mostrar. Esos casos -el nombre comercial repetido, por
 * ejemplo- caen en {@link CausaOffering `conflicto`}, que muestra el `detail` del backend
 * —que si nombra el conflicto concreto— en vez de un generico.
 */
export type CausaOffering =
  /** 403 missing-tenant-context: hay sesion, pero no hay sede elegida. NUNCA cerrar sesion. */
  | 'sin-contexto'
  /** 403 forbidden sobre una oferta: falta `consultorio:manage` en esta sede. */
  | 'sin-permiso'
  /** 403 sobre el catalogo global: administrar Servicios es de la plataforma. */
  | 'sin-rol-de-plataforma'
  /** 400 validation-error. El backend nombra el campo. */
  | 'validacion'
  /** 404: no existe, o es de otro tenant. Los dos responden igual a proposito. */
  | 'no-encontrado'
  /** 409 concurrent-modification: la `expectedVersion` enviada quedo vieja. Ver arriba. */
  | 'concurrencia'
  /** 409 subscription-suspended: lo emite el filtro, antes del controller. */
  | 'suscripcion-suspendida'
  /** 409 practica-no-utilizable: una practica que ENTRA esta dada de baja o fuera de vigencia (A-9). */
  | 'practica-no-utilizable'
  /** 409 oferta-inactiva: la oferta esta dada de baja y no admite cambios. */
  | 'oferta-inactiva'
  /** 409 consultorio-no-operable: la sede no admite cambios ahora. */
  | 'consultorio-no-operable'
  /** 409 precio-particular-solapado: dos precios activos de la misma oferta se pisan. */
  | 'precio-solapado'
  /** 409 precio-particular-inactivo: el precio ya esta dado de baja. */
  | 'precio-inactivo'
  /** 409 honorario-de-clase-solapado: dos tarifas activas de la misma oferta se pisan (DP-38). */
  | 'honorario-solapado'
  /** 409 honorario-de-clase-inactivo: la tarifa ya esta dada de baja. */
  | 'honorario-inactivo'
  /** 409 servicio-codigo-taken / servicio-nombre-taken: ya hay un servicio vigente igual. */
  | 'servicio-duplicado'
  /** 409 servicio-inactivo: el servicio esta dado de baja; no admite ofertas nuevas ni ediciones. */
  | 'servicio-inactivo'
  /** 409 oferta-already-inactive: la baja ya estaba hecha. El estado buscado ya es el que hay. */
  | 'oferta-ya-inactiva'
  /** Cualquier otro 409: unicidad, servicio inactivo, baja ya hecha. Gana el `detail`. */
  | 'conflicto'
  /** 429: hay que esperar. Ver `segundosDeEspera`. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/** Error ya traducido a algo mostrable. */
export interface ErrorOffering {
  readonly mensaje: string;
  readonly causa: CausaOffering;
  /** Segundos a esperar antes de reintentar. 0 fuera de `limite`. */
  readonly segundosDeEspera: number;
}

/** Que se estaba tocando cuando fallo. Cambia el 403 y el 404, no el resto. */
export type AmbitoOffering = 'servicio' | 'oferta';

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
const MENSAJE_LIMITE_SIN_PLAZO =
  'Demasiados intentos. Espera un momento antes de volver a intentar.';

const MENSAJE_SIN_CONTEXTO =
  'Las ofertas son de una sede concreta, asi que hay que saber en cual estas trabajando. Eligi ' +
  'un consultorio y volve a entrar. Tu sesion sigue abierta.';

/**
 * `403` sobre el catalogo global.
 *
 * <p>Es el mensaje que sostiene la decision de la pantalla de servicios: las acciones se
 * muestran y el rechazo lo da el servidor, porque <b>hoy ningun endpoint le dice al frontend
 * si quien mira tiene rol de plataforma</b> (diseno 8). Por eso este texto tiene que explicar
 * la situacion completa: que no es un error del usuario, quien si puede hacerlo, y que el
 * catalogo se sigue pudiendo leer.
 */
const MENSAJE_SIN_ROL_DE_PLATAFORMA =
  'El catalogo de servicios lo administra AKINE, no cada centro: dar de alta, editar o dar de ' +
  'baja un servicio exige rol de plataforma. Podes seguir consultandolo, y lo que si administra ' +
  'tu centro son las ofertas de la sede, que es donde se define como se presta cada servicio.';

const MENSAJE_SIN_PERMISO =
  'No podes modificar las ofertas de esta sede: hace falta administrarla. Pediselo a quien la ' +
  'administra. Consultarlas si podes, y por eso el listado se sigue viendo.';

const MENSAJE_NO_ENCONTRADO_SERVICIO =
  'Ese servicio ya no existe en el catalogo. Recarga el listado para ver los que hay ahora.';

const MENSAJE_NO_ENCONTRADO_OFERTA =
  'Esa oferta ya no existe, o no es de esta sede. Recarga el listado para ver las que hay ahora.';

/**
 * Concurrencia optimista.
 *
 * <p>Dice las tres cosas que el usuario necesita: que <b>no se guardo nada</b>, que no se
 * perdio el cambio de la otra persona, y que lo que sigue es releer y volver a decidir. Un
 * reintento automatico seria justamente pisar lo que el `409` existe para impedir.
 */
const MENSAJE_CONCURRENCIA =
  'Alguien mas modifico esto mientras lo estabas editando, asi que no guardamos tus cambios para ' +
  'no pisar los suyos. Volvimos a leer los datos actuales: revisalos y confirma de nuevo si ' +
  'seguis queriendo el cambio.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripcion de la organizacion esta suspendida, asi que no se pueden registrar cambios. Se ' +
  'resuelve desde la pantalla de suscripcion.';

/**
 * Dos precios activos de la misma oferta no pueden cubrir el mismo dia (RF-M16-009).
 *
 * <p>Nombra la salida concreta: subir un precio es cerrar la vigencia del actual y cargar el
 * nuevo, no editar el importe, que no se edita.
 */
const MENSAJE_PRECIO_SOLAPADO =
  'Ya hay otro precio particular activo de esta oferta que cubre alguno de esos dias, y dos ' +
  'precios no pueden pisarse. Para subir un precio, cerrale la vigencia al actual el dia anterior ' +
  'y carga el nuevo desde el dia siguiente.';

const MENSAJE_PRECIO_INACTIVO =
  'Ese precio ya esta dado de baja, asi que no admite cambios. Recarga la grilla para verlo con ' +
  'su estado actual y, si hace falta, carga otro.';

const MENSAJE_HONORARIO_SOLAPADO =
  'Ya hay otra tarifa de honorario activa de esta oferta que cubre alguno de esos dias, y dos ' +
  'tarifas no pueden pisarse. Para cambiarla, cerrale la vigencia a la actual el dia anterior y ' +
  'carga la nueva desde el dia siguiente.';

const MENSAJE_HONORARIO_INACTIVO =
  'Esa tarifa ya esta dada de baja, asi que no admite cambios. Recarga la grilla para verla con ' +
  'su estado actual y, si hace falta, carga otra.';

const MENSAJE_PRACTICA_NO_UTILIZABLE =
  'Alguna de las practicas que agregaste esta dada de baja o fuera de vigencia en el catalogo, ' +
  'asi que no se puede sumar a la oferta. Sacala de la lista y volve a guardar. Las que la oferta ' +
  'ya tenia no se revalidan: siguen valiendo aunque el catalogo las haya dado de baja.';

const MENSAJE_OFERTA_INACTIVA =
  'Esta oferta esta dada de baja, asi que no admite cambios. Volve al listado de ofertas de la sede.';

const MENSAJE_CONSULTORIO_NO_OPERABLE =
  'La sede no esta operable en este momento, asi que no se pueden cambiar sus ofertas.';

const MENSAJE_SERVICIO_CODIGO_EN_USO =
  'Ya hay un servicio vigente con ese código en el catálogo. Usá otro código: el de un servicio ' +
  'dado de baja sí se puede reusar.';

const MENSAJE_SERVICIO_NOMBRE_EN_USO =
  'Ya hay un servicio vigente con ese nombre en el catálogo (la comparación no distingue ' +
  'mayúsculas ni acentos). Elegí otro nombre o editá el que ya existe.';

const MENSAJE_SERVICIO_INACTIVO =
  'Ese servicio está dado de baja en el catálogo: no admite ofertas nuevas ni cambios. Las ' +
  'ofertas que ya lo prestaban siguen operando. Recargá el listado para ver los vigentes.';

const MENSAJE_OFERTA_YA_INACTIVA =
  'Esa oferta ya estaba dada de baja. No hicimos nada: el estado que buscabas ya es el que hay.';

const MENSAJE_CONFLICTO =
  'El servidor rechazo el cambio por un conflicto con lo que ya hay guardado. Recarga el listado ' +
  'para ver el estado actual y volve a intentar.';

/**
 * Traduce cualquier error de las pantallas de `offering`.
 *
 * <p><b>El `ambito` cambia dos ramas y solo dos:</b> el `403` -que en el catalogo global
 * significa "esto es de la plataforma" y en las ofertas "no administras esta sede"- y el
 * `404`, que tiene que mandar a recargar el listado correcto. El resto es identico, y por eso
 * no hay dos traductores.
 *
 * <p><b>El `detail` del backend gana donde no hay nada mejor que decir</b>: en
 * `validation-error` el servidor nombra el campo, y en los `409` sin tipo propio nombra el
 * conflicto concreto. Donde el frontend sabe algo que el backend no -que existe la pantalla de
 * ofertas, que la sesion sigue abierta- escribe el suyo.
 */
export function traducirErrorOffering(error: unknown, ambito: AmbitoOffering): ErrorOffering {
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
    case 'concurrent-modification':
      return base(MENSAJE_CONCURRENCIA, 'concurrencia');
    case 'precio-particular-solapado':
      return base(MENSAJE_PRECIO_SOLAPADO, 'precio-solapado');
    case 'precio-particular-inactivo':
      return base(MENSAJE_PRECIO_INACTIVO, 'precio-inactivo');
    case 'honorario-de-clase-solapado':
      return base(MENSAJE_HONORARIO_SOLAPADO, 'honorario-solapado');
    case 'honorario-de-clase-inactivo':
      return base(MENSAJE_HONORARIO_INACTIVO, 'honorario-inactivo');
    case 'practica-no-utilizable':
      return base(MENSAJE_PRACTICA_NO_UTILIZABLE, 'practica-no-utilizable');
    case 'oferta-inactiva':
      return base(MENSAJE_OFERTA_INACTIVA, 'oferta-inactiva');
    case 'consultorio-no-operable':
      return base(MENSAJE_CONSULTORIO_NO_OPERABLE, 'consultorio-no-operable');
    case 'servicio-codigo-taken':
      return base(MENSAJE_SERVICIO_CODIGO_EN_USO, 'servicio-duplicado');
    case 'servicio-nombre-taken':
      return base(MENSAJE_SERVICIO_NOMBRE_EN_USO, 'servicio-duplicado');
    case 'servicio-inactivo':
      return base(MENSAJE_SERVICIO_INACTIVO, 'servicio-inactivo');
    case 'oferta-already-inactive':
      return base(MENSAJE_OFERTA_YA_INACTIVA, 'oferta-ya-inactiva');
    default:
      break;
  }

  if (error.status === 403) {
    return ambito === 'servicio'
      ? base(MENSAJE_SIN_ROL_DE_PLATAFORMA, 'sin-rol-de-plataforma')
      : base(MENSAJE_SIN_PERMISO, 'sin-permiso');
  }

  if (error.status === 404) {
    // Inexistente y de otro tenant responden igual: distinguirlos permitiria enumerar las
    // sedes ajenas probando ids.
    return ambito === 'servicio'
      ? base(MENSAJE_NO_ENCONTRADO_SERVICIO, 'no-encontrado')
      : base(MENSAJE_NO_ENCONTRADO_OFERTA, 'no-encontrado');
  }

  if (error.status === 409) {
    // Unicidad del nombre comercial y cualquier otro 409 sin causa propia: el backend nombra
    // cual. Ver el javadoc de arriba sobre por que no se inventan tipos propios.
    return base(conDetalle(error, MENSAJE_CONFLICTO), 'conflicto');
  }

  if (error.status === 400) {
    return base(conDetalle(error, MENSAJE_GENERICO), 'validacion');
  }

  return base(conDetalle(error, MENSAJE_GENERICO), 'otro');
}

/** `true` cuando lo unico que resuelve el error es releer el listado. */
export function hayQueRecargar(causa: CausaOffering | null): boolean {
  return (
    causa === 'no-encontrado' ||
    causa === 'conflicto' ||
    causa === 'precio-inactivo' ||
    causa === 'honorario-inactivo' ||
    causa === 'servicio-inactivo' ||
    causa === 'oferta-ya-inactiva'
  );
}

function base(mensaje: string, causa: CausaOffering): ErrorOffering {
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
