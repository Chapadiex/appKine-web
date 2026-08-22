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
