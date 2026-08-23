import {
  HttpContextToken,
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, switchMap, throwError } from 'rxjs';

import { AuthTokenStore } from '../services/auth-token.store';
import { SessionService } from '../services/session.service';
import { PARAM_VOLVER_A, RUTA_LOGIN, RUTA_SESION_EXPIRADA, destinoInterno } from '../models/rutas';

/**
 * Marca una peticion que ya se reintento despues de un refresh.
 *
 * Sin esta marca, un backend que devuelve 401 con un token recien emitido produce
 * refresh -> reintento -> 401 -> refresh -> ... para siempre.
 */
const YA_REINTENTADA = new HttpContextToken<boolean>(() => false);

/**
 * Rutas de sesion que NUNCA se reintentan tras un 401.
 *
 * <p>`/auth/refresh` y `/auth/login` son los que producen el bucle: un 401 de refresh
 * significa exactamente "no hay sesion que renovar", y responderle con otro refresh es
 * pedirle lo mismo al que acaba de decir que no. Un 401 de login son credenciales
 * incorrectas: renovar no tiene nada que ver.
 */
const RUTAS_SIN_REINTENTO = ['/api/v1/auth/refresh', '/api/v1/auth/login', '/api/v1/auth/logout'];

/**
 * Adjunta el access token y renueva la sesion cuando vence, con cola single-flight.
 *
 * <p>Tres decisiones deliberadas:
 *
 * <ul>
 *   <li><b>Solo a la API propia.</b> Se filtra por prefijo `/api`: mandar el token a un
 *       host de terceros seria filtrarlo.</li>
 *   <li><b>`withCredentials: true`.</b> Necesario para que el navegador envie la cookie
 *       `httpOnly` del refresh token. Es la contraparte de `allowCredentials(true)` en el
 *       CORS del backend, que a su vez obliga a declarar origenes explicitos en lugar de
 *       comodin.</li>
 *   <li><b>Un solo refresh en vuelo.</b> Ver {@link SessionService.refrescar}: la rotacion
 *       del refresh es estricta y reusar uno canjeado revoca la familia entera.</li>
 * </ul>
 *
 * <p><b>REGLA DURA: el token se borra solo ante 401, jamas ante 403.</b> Un 403 significa
 * "falta contexto de tenant" o "no tenes permiso": la sesion es perfectamente valida.
 * Borrar el token ahi manda al login a alguien que ya estaba logueado, y como despues del
 * login vuelve a la misma pantalla que da 403, queda en un bucle. Este interceptor no
 * mira 403 en ningun lado, y es a proposito.
 *
 * <p>El token que se adjunta es el acotado al contexto (Organizacion + Consultorio), no el
 * que devuelve el login. Ver {@link TenantContextStore}.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!esPeticionALaApi(request.url)) {
    return next(request);
  }

  const tokenStore = inject(AuthTokenStore);
  const session = inject(SessionService);
  const router = inject(Router);

  return next(conCredenciales(request, tokenStore.token())).pipe(
    catchError((error: unknown) => {
      if (!esReintentable(error, request)) {
        return throwError(() => error);
      }

      // Se leen ANTES de intentar el refresh: si falla, `limpiarSesion()` deja a todo el
      // mundo anonimo y ya no hay forma de saber si el usuario venia trabajando o nunca
      // entro, que es justo lo que decide a que pantalla se lo manda.
      const habiaSesion = session.estado() !== 'anonimo';
      const desdeDonde = router.url;

      // Todos los 401 concurrentes entran aca y reciben EL MISMO observable de refresh:
      // sale una sola peticion a /auth/refresh y el resto queda encolado esperandola.
      return session.refrescar().pipe(
        catchError(() => {
          // El refresh fallo: la sesion murio de verdad (vencida, revocada o reusada) y el
          // backend ya borro la cookie. Se limpia el estado local y se manda afuera.
          session.limpiarSesion();
          navegarAfuera(router, habiaSesion, desdeDonde);
          // Se propaga el error ORIGINAL: la pantalla pidio pacientes, no un refresh.
          return throwError(() => error);
        }),
        switchMap(() => reintentar(request, next, tokenStore.token())),
      );
    }),
  );
};

/**
 * Saca al usuario de la pantalla que ya no puede cargar, por la puerta que le corresponde.
 *
 * <p><b>Los dos casos no son el mismo mensaje.</b> A quien venia trabajando hay que
 * explicarle que se le cayo la sesion y devolverlo a donde estaba: va a
 * {@link RUTA_SESION_EXPIRADA} con el destino en {@link PARAM_VOLVER_A}, que esa pantalla
 * reenvia al login. A quien nunca tuvo sesion -entro por URL directa a algo que exige una-
 * decirle "tu sesion expiro" seria mentirle: va al login pelado.
 *
 * <p>Se distinguen por `session.estado()` leido <b>antes</b> de limpiar: `anonimo` es el
 * que llego sin nada, cualquier otro estado es el que tenia sesion viva hasta este 401.
 *
 * <p>El destino se sanea igual que si viniera de afuera aunque salga del propio `Router`:
 * el costo es una comparacion y evita depender de que nadie meta nunca una URL absoluta ahi.
 *
 * <p>Los `catch` de la navegacion no son decorativos: si la navegacion falla -ruta todavia
 * no montada, otro guard que la cancela- la promesa rechazada quedaria sin manejar y
 * taparia el error original, que es lo unico que la pantalla necesita ver.
 */
function navegarAfuera(router: Router, habiaSesion: boolean, desdeDonde: string): void {
  if (!habiaSesion) {
    router.navigateByUrl(RUTA_LOGIN).catch(() => undefined);
    return;
  }

  const volverA = destinoInterno(desdeDonde);
  router
    .navigate([RUTA_SESION_EXPIRADA], {
      queryParams: volverA === null ? {} : { [PARAM_VOLVER_A]: volverA },
    })
    .catch(() => undefined);
}

/** Reemite la peticion original con el token nuevo y marcada para no reintentarse otra vez. */
function reintentar(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
  token: string | null,
): Observable<HttpEvent<unknown>> {
  const marcada = conCredenciales(request, token);
  marcada.context.set(YA_REINTENTADA, true);
  return next(marcada);
}

function conCredenciales(
  request: HttpRequest<unknown>,
  token: string | null,
): HttpRequest<unknown> {
  return request.clone({
    withCredentials: true,
    setHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

/**
 * Decide si vale la pena renovar y reintentar.
 *
 * <p>El status se lee tanto de un `HttpErrorResponse` crudo como del `AkineHttpError` que
 * produce el interceptor de errores: en la composicion real este interceptor es el externo,
 * asi que lo que le llega ya viene traducido.
 */
function esReintentable(error: unknown, request: HttpRequest<unknown>): boolean {
  if (statusDe(error) !== 401) {
    return false;
  }
  if (request.context.get(YA_REINTENTADA)) {
    return false;
  }
  return !RUTAS_SIN_REINTENTO.some((ruta) => request.url.includes(ruta));
}

function statusDe(error: unknown): number | null {
  if (error instanceof HttpErrorResponse) {
    return error.status;
  }
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: unknown }).status;
    return typeof status === 'number' ? status : null;
  }
  return null;
}

function esPeticionALaApi(url: string): boolean {
  // El proxy de dev hace que la API sea siempre relativa: /api/...
  // Se descarta cualquier URL absoluta a otro host.
  return url.startsWith('/api') || url.startsWith('api/');
}
