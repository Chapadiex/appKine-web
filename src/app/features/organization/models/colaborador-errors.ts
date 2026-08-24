import { AkineHttpError } from '../../../core/interceptors/error.interceptor';

/**
 * Motivo por el que fallo una operacion sobre colaboradores o auditoria (M05 / M24).
 *
 * <p>Se ramifica por esto y nunca por el texto de `detail`: ese campo es prosa para humanos
 * y cambia cuando alguien corrige una redaccion. Un `if (mensaje.includes('ya existe'))` se
 * rompe con una tilde.
 *
 * <p><b>No importa nada de `features/auth`.</b> Existe un mapeo parecido alla
 * (`auth-errors.ts`), pero un feature no importa de otro (AGENT.md seccion 4) y ademas los
 * casos no son los mismos: aca no hay `401` -ningun endpoint de negocio de AKINE lo
 * devuelve-, hay cuatro conflictos de invariante que alla no existen, y `404` significa una
 * cosa muy concreta. Subirlo a `shared/` tampoco: seria meter reglas de dominio en una
 * carpeta que no puede tenerlas.
 */
export type CausaColaborador =
  /** 403 missing-tenant-context: hay sesion pero no se eligio contexto. */
  | 'sin-contexto'
  /** 403: hay sesion y contexto, pero el rol no alcanza para esta operacion. */
  | 'sin-permiso'
  /** 400 validation-error: faltan campos o alguno no tiene la forma esperada. */
  | 'validacion'
  /** 404: el email no tiene cuenta, o la sede/vinculo no es de esta organizacion. */
  | 'no-encontrado'
  /** 409: se toco un invariante -vinculo duplicado, ultimo admin, self-revoke, estado-. */
  | 'conflicto'
  /** 429: hay que esperar. Ver `segundosDeEspera`. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  | 'otro';

/** Error ya traducido a algo mostrable. */
export interface ErrorColaborador {
  readonly mensaje: string;
  readonly causa: CausaColaborador;
  /** Segundos a esperar antes de reintentar. 0 fuera de `limite`, y 0 en un 429 sin header. */
  readonly segundosDeEspera: number;
}

/** Textos que cada pantalla sobreescribe sin reimplementar el mapeo. */
export interface TextosColaborador {
  /** Que significa un 404 en esta pantalla. Es lo unico que cambia de verdad entre ellas. */
  readonly noEncontrado?: string;
  readonly generico?: string;
}

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';
const MENSAJE_SIN_CONTEXTO = 'Todavia no elegiste un contexto de trabajo.';
const MENSAJE_SIN_PERMISO =
  'No tenes permiso para esta operacion en este contexto. Pediselo a quien administra la organizacion.';
const MENSAJE_LIMITE_SIN_PLAZO =
  'Demasiados intentos. Espera un momento antes de volver a intentar.';

/**
 * Traduce cualquier error de las pantallas de colaboradores y auditoria.
 *
 * <p><b>El `detail` del backend gana siempre que exista.</b> AGENT.md seccion 8 lo pide, y
 * en los `409` es la unica informacion accionable: "no podes revocar al ultimo
 * administrador" y "esa cuenta ya esta vinculada" son dos cosas distintas que el frontend
 * no tiene forma de redactar mejor que quien las decidio. Los textos locales son el
 * respaldo para cuando el cuerpo no trae nada.
 */
export function traducirErrorColaborador(
  error: unknown,
  textos: TextosColaborador = {},
): ErrorColaborador {
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

  if (error.faltaContexto) {
    return { mensaje: MENSAJE_SIN_CONTEXTO, causa: 'sin-contexto', segundosDeEspera: 0 };
  }

  if (error.status === 403) {
    return {
      mensaje: conDetalle(error, MENSAJE_SIN_PERMISO),
      causa: 'sin-permiso',
      segundosDeEspera: 0,
    };
  }

  if (error.status === 404) {
    return {
      mensaje: textos.noEncontrado ?? conDetalle(error, 'No encontramos lo que buscabas.'),
      causa: 'no-encontrado',
      segundosDeEspera: 0,
    };
  }

  if (error.status === 409) {
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
 * <p>Misma decision que en las pantallas de identidad: <b>sin header no se inventa un
 * numero</b>. Un "espera 60 segundos" que no se corresponde con el limite real deja al
 * usuario esperando de mas, o le promete que ya puede y se come otro 429 —y en el alta de
 * colaborador, donde el limite es de 10 por minuto y por IP, cada intento fallido ademas
 * queda auditado en el tenant—.
 */
function segundosDeEspera(error: AkineHttpError): number {
  const segundos = error.reintentarEnSegundos;
  if (segundos === null || !Number.isFinite(segundos) || segundos <= 0) {
    return 0;
  }
  return Math.ceil(segundos);
}
