import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { RUTA_INICIO } from '../../layout/navegacion-principal/secciones';
import { SessionService } from '../services/session.service';
import { trasRestaurarSesion } from './tras-restaurar-sesion';

/**
 * La landing pública (`/`) es para quien todavía no usa AKINE: con sesión se va a su inicio
 * (`AKINE-landing-y-ofertas.md` §4). Una sesión sin contexto también va al inicio, y ahí
 * `contextGuard` la manda al selector.
 *
 * <p>Espera la restauración del arranque como el resto de los guards: leer `estado()` antes
 * mostraría la landing a quien tiene sesión y vuelve a entrar por `/`.
 */
export const landingGuard: CanActivateFn = (_ruta, estado) => {
  const session = inject(SessionService);
  const router = inject(Router);

  return trasRestaurarSesion(estado, () =>
    session.estado() === 'anonimo' ? true : router.createUrlTree([RUTA_INICIO]),
  );
};
