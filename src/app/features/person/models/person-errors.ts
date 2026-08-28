import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Motivo por el que fallo una operacion sobre el padron de personas (M07, AKINE-03.01).
 *
 * <p>Se ramifica por `problemType` y <b>nunca</b> por el texto de `detail`, por lo mismo que en
 * espacios, catalogo y ofertas: `detail` es prosa y cambia cuando alguien corrige una redaccion.
 *
 * <h2>Los dos rechazos del alta son distintos y la pantalla los trata distinto</h2>
 *
 * <p>Es la unica parte de este archivo que no se parece a la de las otras features, y es la razon
 * por la que existe:
 *
 * <ul>
 *   <li><b>`persona-documento-taken`</b> es un invariante DURO. Ya hay alguien vigente con ese
 *       documento en la organizacion. No se puede confirmar ni saltear, y el remedio del operador
 *       es abrir la ficha que ya existe — por eso el error viaja con `personaExistenteId` cuando
 *       el backend lo pudo determinar.</li>
 *   <li><b>`persona-posible-duplicado`</b> es una ADVERTENCIA. Coincide el nombre completo o el
 *       telefono. Viene con `candidatos`, y el operador decide: abre una de esas fichas, o
 *       reenvia el alta declarando que es otra persona. <b>Es RN-M07-001 hecho cumplir por el
 *       backend</b>, no por el formulario.</li>
 * </ul>
 *
 * <p>Meterlos a los dos en un `conflicto` generico seria perder exactamente lo que los hace
 * utiles: en el primero hay una ficha concreta que abrir, y en el segundo hay una decision que el
 * operador puede tomar sin salir de la pantalla.
 *
 * <h2>El 409 de concurrencia llega como `conflict`, NO como `concurrent-modification`</h2>
 *
 * <p>`person` lanza el `OptimisticLockingFailureException` plano y lo mapea el handler global,
 * igual que `offering`. Se reconocen los dos por si algun dia se unifican —es una de las
 * decisiones transversales abiertas del workspace—, pero la rama que hoy se ejercita es
 * `conflict`.
 */
export type CausaPersona =
  /** 403 missing-tenant-context: hay sesion, pero no hay contexto de trabajo. NUNCA cerrar sesion. */
  | 'sin-contexto'
  /** 403 forbidden: falta `paciente:manage`. Leer el padron si se puede. */
  | 'sin-permiso'
  /** 400 validation-error. El backend nombra el campo. */
  | 'validacion'
  /** 404: no existe, o es de otra organizacion. Los dos responden igual a proposito. */
  | 'no-encontrado'
  /** 409 persona-documento-taken. Invariante duro: ver `personaExistenteId`. */
  | 'documento-en-uso'
  /** 409 persona-posible-duplicado. Advertencia confirmable: ver `candidatos`. */
  | 'posible-duplicado'
  /** 409 persona-inactiva: la ficha esta dada de baja y no admite la operacion. */
  | 'persona-inactiva'
  /** 409 conflict: la `expectedVersion` enviada quedo vieja. */
  | 'concurrencia'
  /** 409 subscription-suspended: lo emite el filtro, antes del controller. */
  | 'suscripcion-suspendida'
  /** Cualquier otro 409. Gana el `detail` del backend. */
  | 'conflicto'
  /** 429: hay que esperar. Ver `segundosDeEspera`. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/** Error ya traducido a algo mostrable. */
export interface ErrorPersona {
  readonly mensaje: string;
  readonly causa: CausaPersona;
  /** Segundos a esperar antes de reintentar. 0 fuera de `limite`. */
  readonly segundosDeEspera: number;
  /**
   * Ids que coinciden con el alta rechazada. Vacio fuera de `posible-duplicado`.
   *
   * <p>Sin esto el 409 seria un callejon: el operador sabe que "hay alguien parecido" y no puede
   * verlo, asi que tendria que salir de la pantalla y buscar a mano.
   */
  readonly candidatos: readonly number[];
  /** Ficha que ya tiene ese documento, o `null`. Solo en `documento-en-uso`. */
  readonly personaExistenteId: number | null;
}

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
const MENSAJE_LIMITE_SIN_PLAZO =
  'Demasiados intentos. Espera un momento antes de volver a intentar.';

/**
 * `403` por falta de contexto.
 *
 * <p>Dice explicitamente que la sesion sigue abierta, porque el reflejo del usuario ante un
 * rechazo es pensar que se deslogueo. El padron es de la organizacion, pero <b>dar de alta o
 * editar exige ademas tener una sede elegida</b>: el permiso se evalua con la sede del contexto.
 */
const MENSAJE_SIN_CONTEXTO =
  'Para trabajar con el padron hay que saber en que centro estas. Eligi una organizacion y un ' +
  'consultorio, y volve a entrar. Tu sesion sigue abierta.';

const MENSAJE_SIN_PERMISO =
  'No podes dar de alta ni editar personas: hace falta el permiso de gestion de pacientes. ' +
  'Pediselo a quien administra el centro. Consultar el padron si podes, y por eso el listado se ' +
  'sigue viendo.';

const MENSAJE_NO_ENCONTRADO =
  'Esa persona ya no existe, o no es de esta organizacion. Recarga el listado para ver el padron ' +
  'actual.';

/**
 * Documento repetido: el invariante duro.
 *
 * <p>No ofrece ninguna salida que no sea mirar la ficha que ya existe, porque no la hay: dos
 * personas con el mismo documento en la misma organizacion son un error de carga, siempre.
 */
const MENSAJE_DOCUMENTO_EN_USO =
  'Ya hay una persona registrada con ese documento en esta organizacion. Buscala en el padron ' +
  'antes de crear una ficha nueva: si es la misma persona, editala en vez de duplicarla.';

/**
 * Posible duplicado: la advertencia.
 *
 * <p>Tiene que decir las tres cosas: que <b>no se creo nada</b>, que hay fichas parecidas para
 * mirar, y que si de verdad es otra persona se puede confirmar y seguir. Sin la tercera, el
 * operador con dos pacientes homonimos queda trabado.
 */
const MENSAJE_POSIBLE_DUPLICADO =
  'No creamos la ficha todavia: hay personas registradas que coinciden en el nombre completo o en ' +
  'el telefono. Revisalas abajo. Si es una de ellas, abrila; si es otra persona distinta, ' +
  'confirmalo y la damos de alta.';

const MENSAJE_PERSONA_INACTIVA =
  'Esa persona esta dada de baja, asi que no admite cambios. Su ficha se sigue pudiendo ' +
  'consultar: los historicos no se borran.';

const MENSAJE_CONCURRENCIA =
  'Alguien mas modifico esta ficha mientras la estabas editando, asi que no guardamos tus cambios ' +
  'para no pisar los suyos. Volvimos a leer los datos actuales: revisalos y confirma de nuevo si ' +
  'seguis queriendo el cambio.';

const MENSAJE_SUSCRIPCION_SUSPENDIDA =
  'La suscripcion de la organizacion esta suspendida, asi que no se pueden registrar cambios. Se ' +
  'resuelve desde la pantalla de suscripcion.';

const MENSAJE_CONFLICTO =
  'El servidor rechazo el cambio por un conflicto con lo que ya hay guardado. Recarga el listado ' +
  'para ver el estado actual y volve a intentar.';

/**
 * Traduce cualquier error de la pantalla del padron.
 *
 * <p><b>No recibe un `ambito`</b>, a diferencia del traductor de `offering`: aca todas las
 * operaciones son sobre lo mismo —una persona— y un 403 significa siempre lo mismo. Partirlo en
 * dos habria sido una simetria vacia.
 */
export function traducirErrorPersona(error: unknown): ErrorPersona {
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
    case 'subscription-suspended':
      return base(MENSAJE_SUSCRIPCION_SUSPENDIDA, 'suscripcion-suspendida');
    case 'persona-documento-taken':
      return {
        ...base(MENSAJE_DOCUMENTO_EN_USO, 'documento-en-uso'),
        personaExistenteId: error.numeroDeExtension('personaExistenteId'),
      };
    case 'persona-posible-duplicado':
      return { ...base(MENSAJE_POSIBLE_DUPLICADO, 'posible-duplicado'), candidatos: idsDe(error) };
    case 'persona-inactiva':
      return base(MENSAJE_PERSONA_INACTIVA, 'persona-inactiva');
    case 'conflict':
    // `concurrent-modification` no lo emite `person` hoy. Se reconoce igual por si algun dia se
    // unifican los dos tipos: ver el javadoc de `CausaPersona`.
    // falls through
    case 'concurrent-modification':
      return base(MENSAJE_CONCURRENCIA, 'concurrencia');
    default:
      break;
  }

  if (error.status === 403) {
    return base(MENSAJE_SIN_PERMISO, 'sin-permiso');
  }

  if (error.status === 404) {
    // Inexistente y de otra organizacion responden igual: distinguirlos permitiria medir el
    // padron ajeno probando ids, que es el dato mas sensible despues de la historia clinica.
    return base(MENSAJE_NO_ENCONTRADO, 'no-encontrado');
  }

  if (error.status === 409) {
    return base(conDetalle(error, MENSAJE_CONFLICTO), 'conflicto');
  }

  if (error.status === 400) {
    return base(conDetalle(error, MENSAJE_GENERICO), 'validacion');
  }

  return base(conDetalle(error, MENSAJE_GENERICO), 'otro');
}

/** `true` cuando lo unico que resuelve el error es releer el listado. */
export function hayQueRecargar(causa: CausaPersona | null): boolean {
  return causa === 'no-encontrado' || causa === 'conflicto' || causa === 'concurrencia';
}

function base(mensaje: string, causa: CausaPersona): ErrorPersona {
  return { mensaje, causa, segundosDeEspera: 0, candidatos: [], personaExistenteId: null };
}

/**
 * Los ids de `candidatos`, filtrando lo que no sea un numero.
 *
 * <p>Sale de `extension()`, que ya busca la clave <b>en la raiz y bajo `properties`</b>: Spring
 * serializa las extensiones de `setProperty(...)` como claves de primer nivel y el contrato las
 * declara anidadas, asi que hay que mirar las dos. Escribir el acceso a mano aca habria
 * funcionado con la forma de hoy y roto con la del contrato.
 *
 * <p>`extension()` devuelve `unknown` a proposito, asi que esto <b>valida en vez de confiar</b>:
 * un `candidatos` con un `null` adentro convertiria el listado de coincidencias en un
 * `GET /personas/null`.
 */
function idsDe(error: AkineHttpError): readonly number[] {
  const crudo = error.extension('candidatos');
  if (!Array.isArray(crudo)) {
    return [];
  }
  return crudo.filter(
    (valor): valor is number => typeof valor === 'number' && Number.isFinite(valor),
  );
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
