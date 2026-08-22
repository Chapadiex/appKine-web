import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { AuthTokenStore } from '../services/auth-token.store';

/**
 * Adjunta el access token a las peticiones dirigidas a la API de AKINE.
 *
 * <p>Dos decisiones deliberadas:
 *
 * <ul>
 *   <li><b>Solo a la API propia.</b> Se filtra por prefijo `/api`: mandar el token a un
 *       host de terceros seria filtrarlo.</li>
 *   <li><b>`withCredentials: true`.</b> Necesario para que el navegador envie la cookie
 *       `httpOnly` del refresh token. Es la contraparte de `allowCredentials(true)` en el
 *       CORS del backend, que a su vez obliga a declarar origenes explicitos en lugar
 *       de comodin.</li>
 * </ul>
 *
 * El token que se adjunta es el acotado al contexto (Organizacion + Consultorio), no el
 * que devuelve el login. Ver {@link TenantContextStore}.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!esPeticionALaApi(request.url)) {
    return next(request);
  }

  const token = inject(AuthTokenStore).token();

  const conCredenciales = request.clone({
    withCredentials: true,
    setHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });

  return next(conCredenciales);
};

function esPeticionALaApi(url: string): boolean {
  // El proxy de dev hace que la API sea siempre relativa: /api/...
  // Se descarta cualquier URL absoluta a otro host.
  return url.startsWith('/api') || url.startsWith('api/');
}
