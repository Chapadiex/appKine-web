import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { AuthTokenStore } from '../services/auth-token.store';

/**
 * Formato de error del backend: RFC 7807 Problem Details.
 *
 * Coincide con lo que produce `GlobalExceptionHandler` en appKine-api. El backend nunca
 * expone detalles internos, asi que lo que llega aca ya es apto para mostrar.
 */
export interface ProblemDetail {
  readonly type?: string;
  readonly title?: string;
  readonly status?: number;
  readonly detail?: string;
  readonly instance?: string;
  /** Presente en errores de validacion: campo -> mensaje. */
  readonly errors?: Readonly<Record<string, string>>;
}

/**
 * Tipos de problema que el backend publica bajo `https://akine.app/problems/`.
 *
 * <p>Existen para que las pantallas <b>ramifiquen por un identificador estable</b> y no
 * parseando el texto de `detail`, que es prosa para humanos y cambia sin avisar. Un
 * `if (error.message.includes('suspendida'))` se rompe el dia que alguien corrige una
 * tilde.
 *
 * <p><b>Nota honesta:</b> el contrato OpenAPI 0.2.0 declara `ProblemDetail.type` como un
 * `string`/`uri` libre y <b>no enumera estos valores</b>. La lista se derivo de las
 * descripciones del contrato y de `OrganizationProblemHandler` / `TenantContextFilter` en
 * appKine-api. Si el backend agrega uno nuevo, aca no se entera nada: `problemType`
 * devuelve `null` y la pantalla cae en su rama generica, que es el comportamiento seguro.
 */
export const AKINE_PROBLEM_TYPES = [
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
  ) {
    super(problem?.detail ?? problem?.title ?? 'Error de comunicacion con el servidor');
    this.name = 'AkineHttpError';
  }

  /** Errores de validacion por campo, para pintar el formulario. */
  get erroresPorCampo(): Readonly<Record<string, string>> {
    return this.problem?.errors ?? {};
  }

  /**
   * Identificador estable del problema, o `null` si no es uno de los conocidos.
   *
   * <p>Es el ultimo segmento de `ProblemDetail.type`
   * (`https://akine.app/problems/conflict` -> `'conflict'`). Se devuelve `null` -y no el
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
}

/**
 * Traduce los errores HTTP a un tipo unico y accionable.
 *
 * <p>Un `401` limpia el token en memoria: la sesion dejo de ser valida y dejar el token
 * puesto solo produce una cascada de reintentos fallidos.
 *
 * <p><b>PENDIENTE(F1/M02):</b> ante un `401` hay que intentar el refresh contra la cookie
 * `httpOnly` antes de rendirse, encolando las peticiones concurrentes para no disparar N
 * refresh en paralelo. No se implementa en AKINE-00.01 porque todavia no existe el
 * endpoint de refresh.
 */
export const errorInterceptor: HttpInterceptorFn = (request, next) => {
  const tokenStore = inject(AuthTokenStore);

  return next(request).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) {
        return throwError(() => error);
      }

      // status 0 = el request nunca llego: sin red, CORS, o servidor caido.
      // No es lo mismo que un error del servidor y la UI debe distinguirlo.
      const esDeRed = error.status === 0;

      if (error.status === 401) {
        tokenStore.clear();
      }

      const problem = esProblemDetail(error.error) ? error.error : null;

      return throwError(() => new AkineHttpError(error.status, problem, esDeRed));
    }),
  );
};

function esProblemDetail(cuerpo: unknown): cuerpo is ProblemDetail {
  return typeof cuerpo === 'object' && cuerpo !== null;
}
