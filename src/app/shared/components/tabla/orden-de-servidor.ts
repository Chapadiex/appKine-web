import { Signal, computed, signal } from '@angular/core';

import { DireccionDeOrden, OrdenDeTabla } from './tabla-local';

/**
 * Lo que el encabezado `th[appOrdenable]` necesita de una tabla: en que orden esta y como pedir
 * otro. Lo cumplen las dos formas de ordenar: {@link tablaLocal} (lista completa, ordena en el
 * cliente) y {@link ordenDeServidor} (lista paginada, le pide el orden al servidor).
 */
export interface Ordenable {
  readonly orden: Signal<OrdenDeTabla | null>;
  ordenarPor(columna: string): void;
}

/** El `sort` del contrato (DP-45): un solo `campo,asc` o `campo,desc`, no repetible. */
export type SortDe<C extends string> = `${C},${DireccionDeOrden}`;

/**
 * Los campos que admite el `sort` de una operacion, sacados del tipo generado: con
 * `CamposDeSort<ListEspaciosRequestParams['sort']>` la pantalla no puede pedir un campo que el
 * contrato no declara (el servidor lo rechazaria con 400).
 */
export type CamposDeSort<S> = S extends `${infer C},${DireccionDeOrden}` ? C : never;

/** El orden de una tabla paginada por el servidor. */
export interface OrdenDeServidor<C extends string> extends Ordenable {
  /** Lo que viaja como `sort`, o `undefined` para el orden por defecto de la operacion. */
  readonly sort: Signal<SortDe<C> | undefined>;
  /** Vuelve al orden por defecto sin avisar: para el cambio de contexto, que ya recarga. */
  reiniciar(): void;
}

/**
 * Orden de una tabla **paginada por el servidor** (DP-45, regla de tablas del plan §3.4).
 *
 * <p>Ordenar la pagina visible ordena 20 filas de 2.000 y deja creer que se ordeno todo: aca el
 * orden no se aplica en el cliente, se manda como `sort` y el servidor devuelve la primera pagina
 * del listado entero ordenado. Por eso cada cambio llama a `alCambiar`, que es donde la pantalla
 * vuelve a la pagina 0 y recarga: quedarse en la pagina 4 de otro orden muestra filas sueltas.
 *
 * <p>Mismo ciclo que la tabla local: primera vez ascendente, segunda descendente, tercera vuelve
 * al orden por defecto de la operacion (que no se manda: lo decide el servidor).
 *
 * <p>No sabe de dominio: no conoce los campos, los recibe del encabezado.
 */
export function ordenDeServidor<C extends string>(alCambiar: () => void): OrdenDeServidor<C> {
  const orden = signal<OrdenDeTabla | null>(null);

  return {
    orden: orden.asReadonly(),
    sort: computed(() => {
      const actual = orden();
      return actual === null ? undefined : (`${actual.columna},${actual.direccion}` as SortDe<C>);
    }),
    ordenarPor(columna: string): void {
      const actual = orden();
      if (actual?.columna !== columna) {
        orden.set({ columna, direccion: 'asc' });
      } else if (actual.direccion === 'asc') {
        orden.set({ columna, direccion: 'desc' });
      } else {
        orden.set(null);
      }
      alCambiar();
    },
    reiniciar(): void {
      orden.set(null);
    },
  };
}
