import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { SessionService } from '../services/session.service';
import { PARAM_VOLVER_A, RUTA_LOGIN } from '../models/rutas';

/**
 * Sin sesion, al login. Guarda la URL de destino para volver despues de autenticar.
 *
 * <p><b>Esto es UX, no seguridad.</b> El guard evita una navegacion que iba a terminar en
 * una pantalla vacia con un 401 encima; no protege nada. La autoridad es el backend, que
 * rechaza igual si alguien llega por URL directa, edita el bundle o pega el request en
 * curl. Nada de lo que decida este archivo puede elevar privilegios ni negarlos de verdad:
 * un guard que "protege" es un guard en el que alguien va a confiar de mas.
 *
 * <p>La sesion ya esta resuelta cuando esto corre: `provideAppInitializer` en
 * `app.config.ts` espera a `restaurarSesion()` antes de que el router active nada. Sin esa
 * espera, toda recarga de pagina rebotaria al login mientras el refresh esta en vuelo.
 */
export const authGuard: CanActivateFn = (_ruta, estado) => {
  const session = inject(SessionService);
  const router = inject(Router);

  if (session.estado() !== 'anonimo') {
    return true;
  }

  // `createUrlTree` y no `navigate`: devolver el arbol deja la navegacion cancelada de
  // forma atomica y no genera una entrada de historial intermedia.
  return router.createUrlTree([RUTA_LOGIN], {
    queryParams: { [PARAM_VOLVER_A]: estado.url },
  });
};
