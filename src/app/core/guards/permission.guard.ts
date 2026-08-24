import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, catchError, map, of } from 'rxjs';

import { PermissionsStore } from '../services/permissions.store';
import { SessionService } from '../services/session.service';
import {
  PARAM_VOLVER_A,
  RUTA_LOGIN,
  RUTA_SELECTOR_CONTEXTO,
  RUTA_SIN_PERMISO,
} from '../models/rutas';

/**
 * Exige al menos uno de los permisos para entrar a la ruta.
 *
 * <pre>
 * {
 *   path: 'colaboradores',
 *   canActivate: [authGuard, contextGuard, permissionGuard(PERMISO_COLABORADOR_READ)],
 *   loadComponent: ...
 * }
 * </pre>
 *
 * <p><b>ESTO ES UX, NO SEGURIDAD.</b> Frenar la navegacion no protege absolutamente nada:
 * la pantalla que no se abre corresponde a endpoints que siguen siendo alcanzables con
 * curl, con el bundle editado o con la URL pegada a mano. La autoridad es el backend, que
 * evalua rol, grants, alcance y habilitacion vigente contra la base en cada request —no
 * contra el token, que puede portar un rol ya revocado— y responde `403` igual. Lo unico
 * que este guard evita es que el usuario llegue a una pantalla que se iba a llenar de
 * errores. Un guard en el que alguien confie como control de acceso es peor que no tenerlo:
 * invita a que el endpoint de atras se escriba sin verificar.
 *
 * <p><b>Cualquiera de los permisos alcanza</b> (OR, no AND). Una pantalla que necesita dos
 * cosas a la vez es dos guards encadenados, y asi el mensaje de por que no entra sigue
 * siendo uno solo por permiso. Sin argumentos, deniega: ver
 * {@link PermissionsStore.tieneAlguno}.
 *
 * <p><b>Carga los permisos si hacen falta.</b> Es el primer consumidor que corre en una
 * navegacion directa por URL, cuando nadie los pidio todavia. Devuelve el `Observable` y el
 * router espera: resolver el permiso a medias significaria negar el paso a quien si lo
 * tiene, que es la falla mas cara de las dos. Si la carga <b>falla</b> (red caida, backend
 * abajo) tambien deniega: no se puede afirmar que alguien tiene un permiso que no se pudo
 * consultar, y la pantalla de destino iba a fallar igual.
 *
 * <p>Los casos "sin sesion" y "sin contexto" se resuelven como en {@link authGuard} y
 * {@link contextGuard}, aunque el orden natural en las rutas los ponga antes: sin contexto
 * activo la pregunta por los permisos ni siquiera tiene sentido —son permisos <b>de un
 * contexto</b>— y mandar al selector es la salida util. Mandar a "no tenes permiso" a
 * alguien que solo no eligio consultorio seria mentirle y dejarlo sin nada que hacer.
 */
export function permissionGuard(...permisos: string[]): CanActivateFn {
  return (_ruta, estado) => {
    const session = inject(SessionService);
    const store = inject(PermissionsStore);
    const router = inject(Router);

    const situacion = session.estado();

    if (situacion === 'anonimo') {
      return router.createUrlTree([RUTA_LOGIN], {
        queryParams: { [PARAM_VOLVER_A]: estado.url },
      });
    }

    if (situacion === 'sin-contexto') {
      return router.createUrlTree([RUTA_SELECTOR_CONTEXTO], {
        queryParams: { [PARAM_VOLVER_A]: estado.url },
      });
    }

    const decidir = (): boolean | UrlTree =>
      store.tieneAlguno(...permisos) ? true : router.createUrlTree([RUTA_SIN_PERMISO]);

    if (store.cargados()) {
      return decidir();
    }

    return cargarYDecidir(store, decidir, () => router.createUrlTree([RUTA_SIN_PERMISO]));
  };
}

/** Extraida para que el camino asincrono se lea de un vistazo en el cuerpo del guard. */
function cargarYDecidir(
  store: PermissionsStore,
  decidir: () => boolean | UrlTree,
  denegar: () => UrlTree,
): Observable<boolean | UrlTree> {
  return store.cargar().pipe(
    map(() => decidir()),
    catchError(() => of(denegar())),
  );
}
