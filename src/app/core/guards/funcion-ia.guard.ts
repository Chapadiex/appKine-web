import { computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';

import { FuncionIa, FuncionesIaStore } from '../services/funciones-ia.store';

/**
 * Deja entrar a una pantalla de IA solo si la funcion esta activa en el centro; si no, vuelve al
 * inicio. Espera a que el store sepa (si la lectura falla, deja pasar). Es UX: con la funcion
 * apagada el backend responde 409 o 404 igual.
 */
export function funcionIaGuard(funcion: FuncionIa): CanActivateFn {
  return () => {
    const store = inject(FuncionesIaStore);
    const router = inject(Router);
    const estado = computed(() => {
      if (store.activa(funcion)) {
        return 'activa';
      }
      return store.sabe() ? 'apagada' : 'esperando';
    });
    return toObservable(estado).pipe(
      filter((valor) => valor !== 'esperando'),
      take(1),
      map((valor) => (valor === 'activa' ? true : router.parseUrl('/'))),
    );
  };
}
