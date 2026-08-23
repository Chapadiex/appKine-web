import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

/**
 * Formato de error del backend: RFC 7807 Problem Details.
 *
 * <p>Coincide con lo que produce `GlobalExceptionHandler` en appKine-api. El backend nunca
 * expone detalles internos, asi que lo que llega aca ya es apto para mostrar.
 *
 * <p><b>Hueco de contrato conocido.</b> El `ProblemDetail` generado desde
 * `akine-api.yaml` 0.3.0 declara `detail`, `instance`, `status`, `title`, `type` y un
 * `properties` generico, pero <b>no declara `errors`</b>. En el cable, Spring serializa
 * las extensiones de `setProperty(...)` como claves de primer nivel, asi que el mapa de
 * errores de validacion llega como `errors` al lado de `detail`. Se aceptan las dos formas
 * -raiz y anidada bajo `properties`- porque una de las dos es lo que hay hoy y la otra es
 * lo que diria el contrato si se lo tomara al pie de la letra.
 */
export interface ProblemDetail {
  readonly type?: string;
  readonly title?: string;
  readonly status?: number;
  readonly detail?: string;
  readonly instance?: string;
  /** Presente en errores de validacion: campo -> mensaje. */
  readonly errors?: Readonly<Record<string, string>>;
  /** Extensiones RFC 7807 tal como las declara el contrato generado. */
  readonly properties?: Readonly<Record<string, unknown>>;
}

/**
 * Tipos de problema que el backend publica bajo `https://akine.app/problems/`.
 *
 * <p>Existen para que las pantallas <b>ramifiquen por un identificador estable</b> y no
 * parseando el texto de `detail`, que es prosa para humanos y cambia sin avisar. Un
 * `if (error.message.includes('suspendida'))` se rompe el dia que alguien corrige una
 * tilde.
 *
 * <p><b>Nota honesta:</b> el contrato OpenAPI 0.3.0 sigue declarando `ProblemDetail.type`
 * como un `string`/`uri` libre y <b>no enumera estos valores</b>. La lista se derivo de
 * `GlobalExceptionHandler`, `IdentityProblemHandler`, `OrganizationProblemHandler`,
 * `ProblemResponses` y `SecurityConfig` en appKine-api. Si el backend agrega uno nuevo,
 * aca no se entera nada: `problemType` devuelve `null` y la pantalla cae en su rama
 * generica, que es el comportamiento seguro.
 */
export const AKINE_PROBLEM_TYPES = [
  // --- Organizacion y planes (contrato 0.2.0) ---
  /** 409: el alta supera el tope del plan contratado. */
  'plan-limit-exceeded',
  /** 403: el plan contratado no incluye la funcionalidad. */
  'feature-not-available',
  /** 409: la suscripcion no esta ACTIVA; solo lectura y administracion. */
  'subscription-suspended',
  /** 409: la maquina de estados de la suscripcion no admite ese salto. */
  'invalid-subscription-transition',
  /** 409: misma Idempotency-Key con un payload distinto al original. */
  'idempotency-key-conflict',
  /** 409: bloqueo optimista. Hay que releer y reintentar. */
  'conflict',
  /** 403: hay sesion pero no se eligio contexto de tenant todavia. */
  'missing-tenant-context',

  // --- Identidad y sesion (contrato 0.3.0) ---
  /**
   * 401: credenciales rechazadas.
   *
   * Email inexistente, contrasena incorrecta y cuenta bloqueada / desactivada / pendiente
   * de activacion devuelven los TRES este mismo problema con el mismo cuerpo (ADR-0018).
   * Es anti-enumeracion deliberada: la UI muestra un unico mensaje y no intenta adivinar.
   */
  'invalid-credentials',
  /**
   * 401: el refresh no sirve -vencido, inexistente o ya canjeado-.
   *
   * El caso "ya canjeado" revoca la familia de sesion completa, pero responde IGUAL que
   * los otros dos: el cliente no puede distinguir "te detectamos" de "no servia".
   */
  'invalid-refresh',
  /** 401: el access token presentado es invalido o esta vencido. */
  'invalid-token',
  /** 401: no hay credencial donde hacia falta una. */
  'unauthorized',
  /** 403: hay sesion y contexto, pero el rol no alcanza. NO se borra el token. */
  'forbidden',
  /** 403: el Origin del refresh no esta en la lista permitida. Es un error de configuracion. */
  'csrf-rejected',
  /** 404: el recurso no existe o no es accesible para esta cuenta. */
  'not-found',
  /** 429: demasiados intentos. Ver `reintentarEnSegundos`. */
  'rate-limited',
  /** 400: campos invalidos. Ver `erroresPorCampo`. */
  'validation-error',
  /** 500: falla no prevista. El detalle real quedo en el log del servidor. */
  'internal-error',
] as const;

/** Uno de los problemas conocidos del contrato, o `null` si es otro. */
export type AkineProblemType = (typeof AKINE_PROBLEM_TYPES)[number];

const PROBLEMAS_CONOCIDOS: ReadonlySet<string> = new Set(AKINE_PROBLEM_TYPES);

/** Error de dominio del frontend, ya traducido a algo mostrable. */
export class AkineHttpError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetail | null,
    readonly esDeRed: boolean,
    /** Segundos que pide esperar el backend en un 429, o `null` si no lo dijo. */
    readonly reintentarEnSegundos: number | null = null,
  ) {
    super(problem?.detail ?? problem?.title ?? 'Error de comunicacion con el servidor');
    this.name = 'AkineHttpError';
  }

  /**
   * Mensaje literal del backend, para mostrar tal cual.
   *
   * <p>AGENT.md 8: "los errores del backend se muestran con su mensaje real, no con un
   * generico". El backend ya redacta pensando en el usuario final y nunca filtra internos;
   * reemplazarlo por "Ocurrio un error" tira a la basura la unica informacion accionable.
   */
  get mensaje(): string {
    return this.message;
  }

  /** Errores de validacion por campo, para pintar el formulario. */
  get erroresPorCampo(): Readonly<Record<string, string>> {
    return leerErrores(this.problem);
  }

  /**
   * Identificador estable del problema, o `null` si no es uno de los conocidos.
   *
   * <p>Es el ultimo segmento de `ProblemDetail.type`
   * (`https://akine.app/problems/conflict` -&gt; `'conflict'`). Se devuelve `null` -y no el
   * segmento crudo- ante un tipo desconocido para que el `switch` de la pantalla no pueda
   * quedar creyendo que reconocio algo que no reconoce.
   */
  get problemType(): AkineProblemType | null {
    const type = this.problem?.type;
    if (typeof type !== 'string') {
      return null;
    }

    const segmento = type.split('/').pop() ?? '';
    return PROBLEMAS_CONOCIDOS.has(segmento) ? (segmento as AkineProblemType) : null;
  }

  /** `true` cuando la operacion se rechazo porque la suscripcion no esta ACTIVA. */
  get esSuscripcionSuspendida(): boolean {
    return this.problemType === 'subscription-suspended';
  }

  /** `true` cuando falta elegir contexto de tenant: la salida es /seleccionar-contexto. */
  get faltaContexto(): boolean {
    return this.problemType === 'missing-tenant-context';
  }

  /**
   * `true` cuando el login fue rechazado.
   *
   * No dice por que: credenciales incorrectas, cuenta sin activar y cuenta bloqueada son
   * indistinguibles a proposito. La pantalla muestra un solo mensaje para los tres.
   */
  get esCredencialesInvalidas(): boolean {
    return this.problemType === 'invalid-credentials';
  }

  /** `true` cuando la sesion dejo de existir: hay que volver al login. */
  get esSesionExpirada(): boolean {
    const tipo = this.problemType;
    return tipo === 'invalid-refresh' || tipo === 'invalid-token' || tipo === 'unauthorized';
  }

  /** `true` cuando el backend pidio bajar el ritmo. Ver `reintentarEnSegundos`. */
  get esRateLimited(): boolean {
    return this.problemType === 'rate-limited' || this.status === 429;
  }
}

/**
 * Traduce los errores HTTP a un tipo unico y accionable.
 *
 * <p><b>Este interceptor NO toca el token.</b> Es traduccion pura. El ciclo de vida de la
 * sesion -renovar ante un 401, limpiar cuando el refresh falla- vive entero en
 * `authInterceptor`, que es el que sabe si ese 401 termino en una sesion recuperada o en
 * una perdida. Cuando el borrado vivia aca, un 401 recuperable dejaba el token en `null`
 * durante todo el refresh y la aplicacion parpadeaba al login antes de volver.
 *
 * <p>Corolario de la regla dura: aca tampoco hay ninguna rama por 403. Un 403 es "falta
 * contexto" o "no tenes permiso" y la sesion sigue siendo valida.
 */
export const errorInterceptor: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) {
        return throwError(() => error);
      }

      // status 0 = el request nunca llego: sin red, CORS, o servidor caido.
      // No es lo mismo que un error del servidor y la UI debe distinguirlo.
      const esDeRed = error.status === 0;
      const problem = esProblemDetail(error.error) ? error.error : null;

      return throwError(
        () => new AkineHttpError(error.status, problem, esDeRed, leerRetryAfter(error)),
      );
    }),
  );

function esProblemDetail(cuerpo: unknown): cuerpo is ProblemDetail {
  return typeof cuerpo === 'object' && cuerpo !== null;
}

/**
 * Segundos del header `Retry-After` de un 429.
 *
 * <p>Se propaga a la UI para que pueda decir "reintenta en 45 segundos" en vez de un
 * "demasiados intentos" que no dice cuanto esperar. Solo se acepta la forma numerica: el
 * RFC admite tambien una fecha HTTP, que el `RateLimitFilter` del backend no usa, y
 * parsear una fecha que nunca llega es codigo muerto con una rama que nadie prueba.
 *
 * <p>El header es visible entre origenes solo si el backend lo expone en
 * `Access-Control-Expose-Headers`. Si no lo hace, esto devuelve `null` y la UI cae en su
 * mensaje sin cuenta regresiva; nunca rompe.
 */
function leerRetryAfter(error: HttpErrorResponse): number | null {
  const crudo = error.headers?.get('Retry-After');
  if (crudo === null || crudo === undefined) {
    return null;
  }

  const segundos = Number(crudo);
  return Number.isFinite(segundos) && segundos >= 0 ? segundos : null;
}

/** Mapa campo -&gt; mensaje, este donde este. Ver la nota de hueco de contrato arriba. */
function leerErrores(problem: ProblemDetail | null): Readonly<Record<string, string>> {
  const enRaiz = problem?.errors;
  if (esMapaDeStrings(enRaiz)) {
    return enRaiz;
  }

  const anidado = problem?.properties?.['errors'];
  return esMapaDeStrings(anidado) ? anidado : {};
}

function esMapaDeStrings(valor: unknown): valor is Readonly<Record<string, string>> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}
