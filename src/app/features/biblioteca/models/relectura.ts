import { DestroyRef, Signal, effect, inject, signal } from '@angular/core';
import { Observable, Subscription } from 'rxjs';

/** Cada cuanto se relee mientras haya algo procesandose. */
export const RELECTURA_MS = 5000;

/**
 * Relectura periodica mientras `seguir()` sea verdadero (libros en cola o procesandose).
 *
 * <p>Es una cadena de `setTimeout`, no un `setInterval`: la proxima relectura se agenda recien
 * cuando volvio la anterior (con exito o con error), asi que nunca se apilan dos aunque el
 * servidor tarde mas de {@link RELECTURA_MS}. Se pausa mientras la pestaña esta oculta
 * (`document.visibilityState`) y retoma en `visibilitychange`; se cancela al dejar de haber algo
 * que seguir y al destruirse el contexto de inyeccion.
 *
 * <p>Hay que llamarla en un contexto de inyeccion. `releer` hace la peticion y aplica su
 * resultado; esta funcion solo decide cuando. La usan la lista y el detalle del libro.
 */
export function relecturaMientras(
  seguir: Signal<boolean>,
  releer: () => Observable<unknown>,
): void {
  const visible = signal(document.visibilityState !== 'hidden');
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let enVuelo: Subscription | null = null;

  const quiereSeguir = (): boolean => seguir() && visible();

  const agendar = (): void => {
    if (temporizador !== null || enVuelo !== null) {
      return;
    }
    temporizador = setTimeout(() => {
      temporizador = null;
      const terminar = (): void => {
        enVuelo = null;
        if (quiereSeguir()) {
          agendar();
        }
      };
      // `enVuelo` se asigna antes de que pueda correr un `complete` sincrono: si ya termino, se
      // limpia ahi mismo.
      const suscripcion = releer().subscribe({ complete: terminar, error: terminar });
      enVuelo = suscripcion.closed ? null : suscripcion;
    }, RELECTURA_MS);
  };

  const cancelarTemporizador = (): void => {
    if (temporizador !== null) {
      clearTimeout(temporizador);
      temporizador = null;
    }
  };

  const alCambiarVisibilidad = (): void => visible.set(document.visibilityState !== 'hidden');
  document.addEventListener('visibilitychange', alCambiarVisibilidad);

  effect(() => {
    if (quiereSeguir()) {
      agendar();
    } else {
      cancelarTemporizador();
    }
  });

  inject(DestroyRef).onDestroy(() => {
    document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    cancelarTemporizador();
    enVuelo?.unsubscribe();
    enVuelo = null;
  });
}
