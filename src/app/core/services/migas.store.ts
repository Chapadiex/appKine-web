import {
  DestroyRef,
  Injectable,
  Signal,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

/** Un paso de la ruta de navegacion. Sin `ruta` es la pantalla actual y no es un enlace. */
export interface Miga {
  readonly etiqueta: string;

  readonly ruta?: string | readonly unknown[] | null;
}

/**
 * Las migas que publica la pantalla abierta, para la barra superior (refactor UX/UI del
 * 29/10/2026: la ruta de navegacion vive en la cabecera global, no dentro de cada pantalla).
 *
 * <p><b>Que publica una pantalla.</b> Solo lo que la barra no puede deducir: los niveles
 * intermedios con nombre propio ("Pérez, Ana", "Caso 3", "Aranceles" de un convenio) y, si
 * quiere, una etiqueta mejor para el nivel actual (un ultimo elemento sin `ruta`). La seccion
 * del menu y el titulo de la ruta los pone la barra sola, asi que una pantalla que no publica
 * nada igual tiene migas.
 *
 * <p><b>Una sola pantalla publica a la vez.</b> Cada publicacion lleva su dueno: la pantalla que
 * se destruye retira solo lo suyo, y si la nueva ya publico, no la borra.
 */
@Injectable({ providedIn: 'root' })
export class MigasStore {
  private readonly publicadas = signal<{ readonly dueno: object; readonly migas: readonly Miga[] }>(
    { dueno: {}, migas: [] },
  );

  readonly migas = computed(() => this.publicadas().migas);

  publicar(dueno: object, migas: readonly Miga[]): void {
    this.publicadas.set({ dueno, migas });
  }

  retirar(dueno: object): void {
    if (this.publicadas().dueno === dueno) {
      this.publicadas.set({ dueno: {}, migas: [] });
    }
  }
}

/**
 * Publica las migas de la pantalla mientras viva. Se llama en su contexto de inyeccion (un campo
 * o el constructor); se republica sola cuando cambian los signals que lee (el nombre que llega
 * del backend) y se retira cuando la pantalla se destruye. Devuelve las migas publicadas.
 */
export function publicarMigas(migas: () => readonly Miga[]): Signal<readonly Miga[]> {
  const store = inject(MigasStore);
  const dueno = {};
  const actuales = computed(migas);
  effect(() => {
    const publicadas = actuales();
    untracked(() => store.publicar(dueno, publicadas));
  });
  inject(DestroyRef).onDestroy(() => store.retirar(dueno));
  return actuales;
}
