import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { EsperaPorLimite } from '../../../shared/utils/espera-por-limite';

/**
 * Motivo por el que fallo un envio de las pantallas de identidad (M02).
 *
 * <p>Se ramifica por esto y no por el texto del mensaje: `detail` es prosa para humanos y
 * cambia sin avisar. Un `if (mensaje.includes('vencio'))` se rompe cuando alguien corrige
 * una tilde.
 */
export type CausaError =
  /** 401 del login. Cubre credenciales malas, cuenta sin activar y cuenta bloqueada. */
  | 'credenciales'
  /** 401 de sesion: el token no sirve mas. NO es un problema de contrasena. */
  | 'sesion'
  /** 400 invalid-token: enlace inexistente, usado, invalidado, vencido o del tipo equivocado. */
  | 'token'
  /** 400 validation-error: politica de contrasena o campos ausentes. */
  | 'validacion'
  /** 429: hay que esperar antes de reintentar. */
  | 'limite'
  /** El request nunca llego: sin red, CORS o servidor caido. */
  | 'red'
  /** 403: sin permiso o sin contexto. NUNCA borra la sesion. */
  | 'permiso'
  | 'otro';

/** Estado de un formulario de identidad. Los cuatro casos exigen pantalla distinta. */
export type EstadoFormulario =
  | { readonly tipo: 'editando' }
  | { readonly tipo: 'enviando' }
  | { readonly tipo: 'ok'; readonly mensaje: string }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly causa: CausaError };

/** Error ya traducido a algo mostrable. */
export interface ErrorTraducido {
  readonly mensaje: string;
  readonly causa: CausaError;
  /**
   * Segundos a esperar antes de reintentar.
   *
   * <p>0 salvo en `limite`, y <b>tambien 0 en un `limite` sin `Retry-After`</b>: no se
   * inventa una espera. Ver {@link segundosDeEspera}.
   */
  readonly segundosDeEspera: number;
}

/** Textos que cada pantalla puede sobreescribir sin reimplementar el mapeo. */
export interface TextosDeError {
  readonly credenciales?: string;
  readonly sesion?: string;
  readonly token?: string;
  readonly generico?: string;
}

/**
 * Texto del 401 que NO es del login.
 *
 * <p>Un `unauthorized` sobre un endpoint de negocio significa que el token dejo de servir,
 * no que la contrasena este mal. Mandar a revisar la contrasena ante eso es la respuesta
 * equivocada: la contrasena esta bien y el usuario la va a reescribir igual, dos veces,
 * antes de sospechar de la sesion.
 */
const MENSAJE_SESION = 'Tu sesion ya no es valida. Volve a iniciar sesion para continuar.';

const MENSAJE_GENERICO = 'No pudimos completar la operacion. Volve a intentar en un momento.';
const MENSAJE_DE_RED = 'No se pudo contactar al servidor. Revisa tu conexion y volve a intentar.';

/** Texto del 429 cuando el backend no dijo cuanto hay que esperar. */
const MENSAJE_LIMITE_SIN_PLAZO =
  'Demasiados intentos. Espera un momento antes de volver a intentar.';

/** Traduce cualquier error de las pantallas de identidad a mensaje + causa. */
export function traducirError(error: unknown, textos: TextosDeError = {}): ErrorTraducido {
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

  // Un 401 que NO es `invalid-credentials`: la sesion se cayo. Se distingue por el
  // `problemType` -`unauthorized`, `invalid-token`, `invalid-refresh`-, que es OTRO tipo de
  // problema, y nunca por el status ni por el texto. `esSesionExpirada` es false para
  // `invalid-credentials`, asi que esta rama no puede robarle ninguno de los tres casos que
  // el ADR-0018 exige indistinguibles: la rama de abajo los sigue recibiendo a los tres.
  //
  // El guardia de status 401 importa: `invalid-token` tambien viaja en los 400 de los
  // enlaces de correo, y ahi significa "el enlace vencio", no "se cayo la sesion".
  if (error.status === 401 && error.esSesionExpirada) {
    return { mensaje: textos.sesion ?? MENSAJE_SESION, causa: 'sesion', segundosDeEspera: 0 };
  }

  // 401 uniforme (ADR-0018): credenciales incorrectas, cuenta pendiente de activacion y
  // cuenta bloqueada llegan las tres con este mismo cuerpo. Distinguirlas en pantalla
  // convertiria el login en un verificador de emails y tiraria el trabajo del backend.
  if (error.status === 401) {
    return {
      mensaje: textos.credenciales ?? 'Email o contrasena incorrectos.',
      causa: 'credenciales',
      segundosDeEspera: 0,
    };
  }

  if (error.status === 403) {
    return { mensaje: error.message, causa: 'permiso', segundosDeEspera: 0 };
  }

  if (error.problemType === 'invalid-token') {
    return {
      mensaje: textos.token ?? 'El enlace vencio o ya se uso. Pedi uno nuevo.',
      causa: 'token',
      segundosDeEspera: 0,
    };
  }

  // El resto de los 400 se muestra con el `detail` literal del backend: la politica de
  // contrasena es lo unico especifico y accionable que este flujo puede decir.
  if (error.status === 400) {
    return { mensaje: error.message, causa: 'validacion', segundosDeEspera: 0 };
  }

  return { mensaje: error.message, causa: 'otro', segundosDeEspera: 0 };
}

/**
 * Espera declarada por el backend en la cabecera `Retry-After`, o `0` si no la mando.
 *
 * <p><b>Fuente unica: el header.</b> Lo lee `errorInterceptor` y lo publica como
 * `reintentarEnSegundos`. Es visible entre origenes porque el backend lo declara en
 * `setExposedHeaders`. Antes esto leia `retryAfterSeconds` del cuerpo -que el contrato
 * nunca declaro- con un piso de 60 s: dos fuentes para el mismo dato y una de ellas
 * inventando el valor.
 *
 * <p><b>Sin header no se inventa un numero.</b> Un "espera 60 segundos" que no se
 * corresponde con el limite real del backend es peor que no decir nada: si el limite era de
 * 10 s deja al usuario esperando de mas, y si era de 5 minutos le promete que a los 60 s ya
 * puede, se come otro 429 y encima -en los endpoints con limite por IP- alarga su propio
 * bloqueo. Con `0` la pantalla muestra {@link MENSAJE_LIMITE_SIN_PLAZO}, sin cuenta
 * regresiva y sin boton bloqueado: el usuario decide cuando reintentar y la autoridad
 * sigue siendo el backend, que rechaza igual si es demasiado pronto.
 */
function segundosDeEspera(error: AkineHttpError): number {
  const segundos = error.reintentarEnSegundos;
  if (segundos === null || !Number.isFinite(segundos) || segundos <= 0) {
    return 0;
  }
  return Math.ceil(segundos);
}

/**
 * Traduce el error y, si fue un `429` con plazo, arranca la cuenta regresiva.
 *
 * <p>Existe porque las seis pantallas de identidad repetian el mismo "si la causa es
 * limite, iniciar la espera" a mano: es una regla del flujo, no de cada pantalla, y
 * olvidarla en una sola deja el boton habilitado para comerse otro rechazo.
 */
export function traducirYEsperar(
  error: unknown,
  espera: EsperaPorLimite,
  textos: TextosDeError = {},
): ErrorTraducido {
  const traducido = traducirError(error, textos);
  if (traducido.causa === 'limite') {
    espera.iniciar(traducido.segundosDeEspera);
  }
  return traducido;
}
