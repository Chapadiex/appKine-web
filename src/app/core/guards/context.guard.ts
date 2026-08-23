import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { SessionService } from '../services/session.service';
import { PARAM_VOLVER_A, RUTA_LOGIN, RUTA_SELECTOR_CONTEXTO } from '../models/rutas';

/**
 * Sesion sin contexto elegido, al selector de Organizacion + Consultorio (DP-02).
 *
 * <p>Con un token `pre_context` <b>ningun</b> endpoint de negocio responde: el backend
 * corta con `403 missing-tenant-context`. Sin este guard, la pantalla se montaria entera
 * para llenarse de errores.
 *
 * <p><b>Esto es UX, no seguridad.</b> El backend valida el alcance del token en cada
 * request; que aca se deje pasar o no cambia lo que ve el usuario, nunca lo que puede
 * hacer.
 *
 * <p>Se usa junto a `authGuard`, no en su lugar: cubre el caso anonimo por si alguien lo
 * monta solo, pero el orden natural en las rutas es `[authGuard, contextGuard]`.
 */
export const contextGuard: CanActivateFn = (_ruta, estado) => {
  const session = inject(SessionService);
  const router = inject(Router);

  const situacion = session.estado();

  if (situacion === 'activa') {
    return true;
  }

  if (situacion === 'anonimo') {
    return router.createUrlTree([RUTA_LOGIN], {
      queryParams: { [PARAM_VOLVER_A]: estado.url },
    });
  }

  // Autenticado pero sin contexto: se recuerda a donde queria ir para que el selector lo
  // devuelva ahi una vez que el token quede acotado.
  return router.createUrlTree([RUTA_SELECTOR_CONTEXTO], {
    queryParams: { [PARAM_VOLVER_A]: estado.url },
  });
};
