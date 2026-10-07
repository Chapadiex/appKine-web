import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';

import { PlatformRoleStore } from '../services/platform-role.store';
import { SessionService } from '../services/session.service';
import { PARAM_VOLVER_A, RUTA_LOGIN, RUTA_SIN_PERMISO } from '../models/rutas';

/**
 * Solo deja entrar a la consola de plataforma a quien administra la plataforma (AKINE-A-7).
 *
 * <p><b>ESTO ES UX, NO SEGURIDAD.</b> Los endpoints de la consola verifican el rol contra
 * `platform_role` en cada request y responden `403` igual. Lo que el guard evita es que una
 * cuenta de centro abra una bandeja que se iba a llenar de errores.
 *
 * <p><b>No exige contexto</b>, y a proposito: un administrador de plataforma no es miembro de
 * ningun centro, opera con el token `pre_context` y el backend lo deja pasar sin tenant.
 * Poner `contextGuard` delante lo mandaria a un selector sin nada que elegir.
 */
export const platformAdminGuard: CanActivateFn = (_ruta, estado) => {
  const session = inject(SessionService);
  const rol = inject(PlatformRoleStore);
  const router = inject(Router);

  if (session.estado() === 'anonimo') {
    return router.createUrlTree([RUTA_LOGIN], {
      queryParams: { [PARAM_VOLVER_A]: estado.url },
    });
  }

  return rol
    .resolver()
    .pipe(map((admin) => (admin ? true : router.createUrlTree([RUTA_SIN_PERMISO]))));
};
