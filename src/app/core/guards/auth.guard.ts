import { inject } from '@angular/core';
import { CanActivateFn, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { map } from 'rxjs';

import { SessionService } from '../services/session.service';
import { TerminosPendientesStore } from '../services/terminos-pendientes.store';
import { PARAM_VOLVER_A, RUTA_ACEPTAR_TERMINOS, RUTA_LOGIN } from '../models/rutas';
import { trasRestaurarSesion } from './tras-restaurar-sesion';

/**
 * Sin sesion, al login. Guarda la URL de destino para volver despues de autenticar. Con sesion
 * pero con los terminos vigentes sin aceptar (19/11/2026), a aceptarlos.
 *
 * <p><b>Esto es UX, no seguridad.</b> El guard evita una navegacion que iba a terminar en
 * una pantalla vacia con un 401 encima; no protege nada. La autoridad es el backend, que
 * rechaza igual si alguien llega por URL directa, edita el bundle o pega el request en
 * curl. Nada de lo que decida este archivo puede elevar privilegios ni negarlos de verdad:
 * un guard que "protege" es un guard en el que alguien va a confiar de mas. Lo mismo con los
 * terminos: el backend responde 403 `terminos-pendientes` igual.
 *
 * <p>Decide con la sesion resuelta: si la restauracion del arranque sigue en vuelo,
 * {@link trasRestaurarSesion} la espera. Sin esa espera, toda recarga de pagina rebotaria al
 * login mientras el refresh esta en vuelo.
 */
export const authGuard: CanActivateFn = (_ruta, estado) => {
  const session = inject(SessionService);
  const router = inject(Router);
  const terminos = inject(TerminosPendientesStore);

  return trasRestaurarSesion(estado, () => {
    if (session.estado() === 'anonimo') {
      return alLogin(router, estado);
    }
    const aAceptar = (pendiente: boolean): true | UrlTree =>
      pendiente
        ? router.createUrlTree([RUTA_ACEPTAR_TERMINOS], {
            queryParams: { [PARAM_VOLVER_A]: estado.url },
          })
        : true;
    // Ya leídos para esta cuenta: se decide en el acto, sin HTTP en cada navegación.
    const leidos = terminos.terminos();
    if (leidos !== null) {
      return aAceptar(leidos.pendiente === true);
    }
    return terminos.pendiente().pipe(map(aAceptar));
  });
};

/**
 * Solo exige sesion, sin mirar los terminos. Es el guard de la pantalla que los acepta: con
 * {@link authGuard} seria inalcanzable para quien los tiene pendientes.
 */
export const sesionGuard: CanActivateFn = (_ruta, estado) => {
  const session = inject(SessionService);
  const router = inject(Router);

  return trasRestaurarSesion(estado, () =>
    session.estado() === 'anonimo' ? alLogin(router, estado) : true,
  );
};

// `createUrlTree` y no `navigate`: devolver el arbol deja la navegacion cancelada de
// forma atomica y no genera una entrada de historial intermedia.
function alLogin(router: Router, estado: RouterStateSnapshot): UrlTree {
  return router.createUrlTree([RUTA_LOGIN], {
    queryParams: { [PARAM_VOLVER_A]: estado.url },
  });
}
