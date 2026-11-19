import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { RUTA_INICIO } from '../../layout/navegacion-principal/secciones';
import { PlatformRoleStore } from '../services/platform-role.store';
import { SessionService } from '../services/session.service';
import { trasRestaurarSesion } from './tras-restaurar-sesion';

/** La consola de la administración de plataforma (`features/platform`). */
const RUTA_PLATAFORMA = '/plataforma';

/**
 * La landing pública (`/`) y el ingreso (`/auth/ingresar`) son para quien no tiene sesión
 * (`AKINE-landing-y-ofertas.md` §4). Con sesión se va adentro: la administración de plataforma
 * a su consola, porque su rol le quita los permisos del centro, y el resto a su inicio. Una
 * sesión sin contexto también va al inicio, y ahí `contextGuard` la manda al selector.
 *
 * <p>Que el ingreso respete la sesión es lo que hace visible "Mantener la sesión iniciada":
 * sin esto, volver a `/auth/ingresar` mostraba el formulario vacío aunque la sesión siguiera
 * viva.
 *
 * <p>Espera la restauración del arranque como el resto de los guards: leer `estado()` antes
 * mostraría la landing a quien tiene sesión y vuelve a entrar por `/`.
 */
export const landingGuard: CanActivateFn = (_ruta, estado) => {
  const session = inject(SessionService);
  const router = inject(Router);
  const rolDePlataforma = inject(PlatformRoleStore);

  return trasRestaurarSesion(estado, () => {
    if (session.estado() === 'anonimo') {
      return true;
    }
    return rolDePlataforma.resolver().pipe(
      catchError(() => of(false)),
      map((admin) => router.createUrlTree([admin ? RUTA_PLATAFORMA : RUTA_INICIO])),
    );
  });
};
