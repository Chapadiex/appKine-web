import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, from, of, switchMap, throwError } from 'rxjs';

import { ProblemType } from '../../api/generated/model/problem-type';

/**
 * Formato de error del backend: RFC 7807 Problem Details.
 *
 * <p>Coincide con lo que produce `GlobalExceptionHandler` en appKine-api. El backend nunca
 * expone detalles internos, asi que lo que llega aca ya es apto para mostrar.
 *
 * <p><b>Hueco de contrato conocido.</b> El `ProblemDetail` generado desde
 * `akine-api.yaml` 0.6.0 declara `detail`, `instance`, `status`, `title`, `type` y un
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
 * Ultimo segmento de una URI, a nivel de tipo.
 *
 * <p>`'https://akine.app/problems/conflict'` -&gt; `'conflict'`. Es recursivo a proposito y no
 * un match contra `/problems/`: si el backend publicara alguna vez una URI con otra base,
 * esto sigue dando el ultimo segmento en vez de colapsar a `never` sin que nadie se entere.
 */
type UltimoSegmento<T extends string> = T extends `${string}/${infer Resto}`
  ? UltimoSegmento<Resto>
  : T;

/**
 * Uno de los problemas del catalogo del contrato, o `null` si es otro.
 *
 * <p>Se deriva del enum `ProblemType` del cliente generado -el catalogo cerrado que el
 * contrato publica desde 0.6.0-, no de una copia a mano. Esa copia se mantenia
 * transcribiendo los handlers del backend y ya se habia desincronizado: tenia 27 entradas
 * contra las 29 del catalogo real, sin `organization-slug-taken` ni
 * `consultorio-has-active-references`.
 *
 * <p>Al ser una union cerrada de literales, comparar `problemType` contra un valor que no
 * esta en el catalogo <b>no compila</b>. Ese es todo el punto: un codigo inventado o mal
 * escrito se cae en el build y no en produccion.
 *
 * <p><b>Hueco de contrato.</b> `ProblemDetail.type` sigue declarado como `string`/`uri` y
 * <b>no referencia</b> a `ProblemType`, que en 0.6.0 queda como un schema suelto que ningun
 * otro schema usa. Por eso el reconocimiento se hace aca a mano contra el enum en vez de
 * salir tipado del cuerpo de la respuesta.
 */
export type AkineProblemType = UltimoSegmento<`${ProblemType}`>;

/**
 * Los mismos valores, en runtime.
 *
 * <p>El catalogo es cerrado <b>en compilacion</b>, no en el cable: un backend mas nuevo
 * puede mandar un `type` que este cliente no conoce. Ante eso
 * {@link AkineHttpError.problemType} devuelve `null` y la pantalla cae en su rama generica,
 * que es el comportamiento seguro.
 */
const PROBLEMAS_CONOCIDOS: ReadonlySet<string> = new Set(
  Object.values(ProblemType).map(ultimoSegmento),
);

function ultimoSegmento(uri: string): string {
  return uri.split('/').pop() ?? '';
}

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
   * Extension RFC 7807 del cuerpo, o `undefined` si no vino.
   *
   * <p>Algunos problemas traen datos que la pantalla necesita para redactar un mensaje util
   * en vez de uno generico: `plan-limit-exceeded` manda `limitCode`, `limitValue` y
   * `currentUsage`, y sin ellos lo unico que se puede decir es "conflicto".
   *
   * <p>Se busca en la raiz y despues bajo `properties` por la misma razon que
   * {@link erroresPorCampo}: Spring serializa las extensiones de `setProperty(...)` como
   * claves de primer nivel, mientras que el `ProblemDetail` del contrato las declararia
   * anidadas. Una de las dos formas es lo que hay hoy y la otra es lo que dice el contrato.
   *
   * <p>Devuelve `unknown` a proposito: el contrato no tipa estas claves, asi que quien la
   * usa tiene que verificar la forma antes de confiar en ella.
   */
  extension(clave: string): unknown {
    const problem = this.problem as Readonly<Record<string, unknown>> | null;
    const enRaiz = problem?.[clave];
    return enRaiz === undefined ? this.problem?.properties?.[clave] : enRaiz;
  }

  /** Extension numerica, o `null` si no vino o no es un numero. */
  numeroDeExtension(clave: string): number | null {
    const valor = this.extension(clave);
    return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
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

    const segmento = ultimoSegmento(type);
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
      const espera = leerRetryAfter(error);

      // Una peticion binaria -`responseType: 'blob'`, que es como se descarga un adjunto- recibe
      // el cuerpo del ERROR tambien como Blob. Un Blob es un objeto no nulo, asi que pasaba por
      // ProblemDetail sin serlo: `type` quedaba `undefined`, `problemType` daba `null` y la
      // pantalla caia en su mensaje generico. Se perdia justo lo unico accionable -
      // `adjunto-no-disponible`, que le dice al operador que no vuelva a subir el archivo sobre
      // esa fila-. Leer el Blob es asincronico, por eso esta rama devuelve un observable propio.
      if (error.error instanceof Blob) {
        return from(error.error.text()).pipe(
          catchError(() => of('')),
          switchMap((texto) =>
            throwError(
              () => new AkineHttpError(error.status, problemDelTexto(texto), esDeRed, espera),
            ),
          ),
        );
      }

      const problem = esProblemDetail(error.error) ? error.error : null;

      return throwError(() => new AkineHttpError(error.status, problem, esDeRed, espera));
    }),
  );

function esProblemDetail(cuerpo: unknown): cuerpo is ProblemDetail {
  return typeof cuerpo === 'object' && cuerpo !== null;
}

/**
 * El `ProblemDetail` que venia dentro de un cuerpo binario, o `null`.
 *
 * <p>Un error de una descarga no siempre trae JSON: puede ser la pagina HTML de un proxy, un
 * cuerpo vacio o el texto de un gateway. Nada de eso es un problema del backend y forzarlo
 * seria inventar un `type`, asi que se devuelve `null` y quien traduce usa su mensaje generico
 * —que es exactamente lo correcto cuando el rechazo no vino de la API—.
 */
function problemDelTexto(texto: string): ProblemDetail | null {
  if (texto.trim() === '') {
    return null;
  }
  try {
    const analizado: unknown = JSON.parse(texto);
    return esProblemDetail(analizado) ? analizado : null;
  } catch {
    return null;
  }
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
