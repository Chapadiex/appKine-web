import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  GuardResult,
  MaybeAsync,
  RouterStateSnapshot,
} from '@angular/router';
import { from, isObservable, of, switchMap } from 'rxjs';

import { SessionService } from '../services/session.service';

/**
 * Corre la decision de un guard cuando la sesion ya esta resuelta (AKINE-LCP).
 *
 * <p>La restauracion del arranque ya no bloquea a la aplicacion (`app.config.ts`): corre en
 * paralelo con la navegacion inicial. Un guard que leyera `session.estado()` en ese momento
 * veria `anonimo` y mandaria al login a alguien que tiene sesion. Por eso todos los guards que
 * miran la sesion pasan por aca:
 *
 * <ul>
 *   <li><b>Sin restauracion en vuelo</b> —toda navegacion salvo la primera— decide en el acto,
 *       igual que antes: el resultado es sincronico.</li>
 *   <li><b>Con la restauracion en vuelo</b> espera a que termine y recien ahi decide. Mientras
 *       tanto pide el codigo de la pantalla de destino: el router solo baja el componente
 *       DESPUES de los guards, y sin esto el refresh y la bajada irian en serie, que es
 *       justamente la cadena que G-10 midio en el movil.</li>
 * </ul>
 *
 * <p>La precarga no decide nada ni saltea ningun guard: solo adelanta un `import()` que el
 * router va a hacer igual si el guard deja pasar. Si el guard redirige, el modulo queda en la
 * cache del navegador sin ejecutarse como pantalla.
 */
export function trasRestaurarSesion(
  estado: RouterStateSnapshot,
  decidir: () => MaybeAsync<GuardResult>,
): MaybeAsync<GuardResult> {
  const session = inject(SessionService);

  if (!session.restaurando()) {
    return decidir();
  }

  precargarDestino(estado.root);

  return session.esperarRestauracion().pipe(
    switchMap(() => {
      const resultado = decidir();
      return isObservable(resultado) || resultado instanceof Promise
        ? from(resultado)
        : of(resultado);
    }),
  );
}

/**
 * Dispara el `loadComponent` de cada ruta del destino. El navegador no baja dos veces el mismo
 * modulo: el `import()` que el router hace despues resuelve del mapa de modulos ya cargados.
 */
function precargarDestino(raiz: ActivatedRouteSnapshot | undefined): void {
  for (let actual = raiz ?? null; actual !== null; actual = actual.firstChild) {
    const cargar = actual.routeConfig?.loadComponent;
    if (cargar) {
      // Un fallo de red aca no importa: el router vuelve a pedirlo y es ESE el que se reporta.
      // Las rutas de AKINE devuelven el `import()` (una Promise); otra forma no se precarga.
      try {
        const carga = cargar();
        if (carga instanceof Promise) {
          carga.catch(() => undefined);
        }
      } catch {
        // idem: el router lo reintenta y reporta
      }
    }
  }
}
