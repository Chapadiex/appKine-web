import { Signal, computed, linkedSignal, signal } from '@angular/core';

/** Valor por el que se compara una fila en una columna. `null` y `undefined` van al final. */
export type ValorOrdenable = string | number | boolean | Date | null | undefined;

export type DireccionDeOrden = 'asc' | 'desc';

export interface OrdenDeTabla {
  readonly columna: string;
  readonly direccion: DireccionDeOrden;
}

export interface OpcionesDeTabla<T> {
  /** Como se lee cada columna ordenable de una fila. La clave es la que usa `appOrdenable`. */
  readonly columnas: Readonly<Record<string, (fila: T) => ValorOrdenable>>;
  /** Filas por pagina al llegar. Default 10, el de toda tabla de AKINE (UX-14). */
  readonly porPagina?: number;
  /** Orden al llegar. Sin el, las filas quedan en el orden en que las devolvio el servidor. */
  readonly ordenInicial?: OrdenDeTabla;
}

/** El estado de una tabla de lista completa: orden, pagina y las filas que se ven. */
export interface TablaLocal<T> {
  /** Pagina mostrada, en base 0 (como la pide `app-paginacion`). */
  readonly pagina: Signal<number>;
  readonly totalPaginas: Signal<number>;
  /** Total de filas, sin paginar: para "N resultados". */
  readonly total: Signal<number>;
  /** Filas por pagina; el usuario la cambia desde el pie (10, 25, 50 o 100). */
  readonly porPagina: Signal<number>;
  readonly orden: Signal<OrdenDeTabla | null>;
  /** Las filas de la pagina actual, ya ordenadas. Es lo que recorre el `@for`. */
  readonly visibles: Signal<readonly T[]>;
  /** Ordena por la columna; si ya estaba, invierte; la tercera vez vuelve al orden original. */
  ordenarPor(columna: string): void;
  irA(pagina: number): void;
  /** Va a la pagina donde queda la fila. `false` si la fila no esta entre las filas (un filtro). */
  mostrar(fila: T): boolean;
  /** Cambia las filas por pagina y vuelve a la primera. */
  cambiarPorPagina(porPagina: number): void;
  /**
   * Corre un cambio de las filas sin volver a la primera pagina: es para una relectura de lo mismo,
   * no para otro filtro. Si la pagina dejo de existir, queda en la ultima.
   */
  conservandoPagina(cambio: () => void): void;
}

const comparador = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

function comparar(a: ValorOrdenable, b: ValorOrdenable): number {
  const vacioA = a === null || a === undefined || a === '';
  const vacioB = b === null || b === undefined || b === '';
  if (vacioA || vacioB) return vacioA === vacioB ? 0 : vacioA ? 1 : -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return comparador.compare(String(a), String(b));
}

/**
 * Paginado y ordenamiento de una tabla cuya lista llega **completa** del servidor (UX-01, regla de
 * tablas del plan §3.4).
 *
 * <p><b>Solo para listas completas.</b> Ordenar una pagina de un listado paginado por el servidor
 * ordena 20 filas de 2.000 y deja creer que se ordeno todo: en esos listados el orden lo pide
 * `ordenDeServidor` como `sort` (DP-45) y la pagina la maneja `app-paginacion` con el `page` del
 * servidor.
 *
 * <p><b>Volver a la primera pagina</b> cuando cambian las filas (otro filtro, una recarga) o el
 * orden: quedarse en la pagina 4 de una lista que ahora tiene 2 es una pantalla vacia sin motivo.
 * Una relectura de la misma lista, con la persona mirando la fila que toco, va por
 * {@link TablaLocal.conservandoPagina}.
 *
 * <p>El orden es estable: a igual valor, se respeta el orden original del servidor.
 */
export function tablaLocal<T>(
  filas: Signal<readonly T[]>,
  opciones: OpcionesDeTabla<T>,
): TablaLocal<T> {
  const porPagina = signal(opciones.porPagina ?? 10);
  const orden = signal<OrdenDeTabla | null>(opciones.ordenInicial ?? null);

  const ordenadas = computed(() => {
    const lista = filas();
    const actual = orden();
    const leer = actual ? opciones.columnas[actual.columna] : undefined;
    if (!actual || !leer) return lista;
    const signo = actual.direccion === 'asc' ? 1 : -1;
    return lista
      .map((fila, indice) => ({ fila, indice, valor: leer(fila) }))
      .sort((x, y) => signo * comparar(x.valor, y.valor) || x.indice - y.indice)
      .map((x) => x.fila);
  });

  const total = computed(() => filas().length);
  const totalPaginas = computed(() => Math.max(1, Math.ceil(total() / porPagina())));

  const pagina = linkedSignal<
    { filas: readonly T[]; orden: OrdenDeTabla | null; porPagina: number },
    number
  >({
    source: () => ({ filas: filas(), orden: orden(), porPagina: porPagina() }),
    computation: () => 0,
  });

  const visibles = computed(() => {
    const desde = Math.min(pagina(), totalPaginas() - 1) * porPagina();
    return ordenadas().slice(desde, desde + porPagina());
  });

  return {
    pagina: pagina.asReadonly(),
    totalPaginas,
    total,
    porPagina: porPagina.asReadonly(),
    orden: orden.asReadonly(),
    visibles,
    ordenarPor(columna: string): void {
      const actual = orden();
      if (actual?.columna !== columna) {
        orden.set({ columna, direccion: 'asc' });
      } else if (actual.direccion === 'asc') {
        orden.set({ columna, direccion: 'desc' });
      } else {
        orden.set(opciones.ordenInicial ?? null);
      }
    },
    irA(destino: number): void {
      pagina.set(Math.max(0, Math.min(destino, totalPaginas() - 1)));
    },
    mostrar(fila: T): boolean {
      const indice = ordenadas().indexOf(fila);
      if (indice < 0) return false;
      pagina.set(Math.floor(indice / porPagina()));
      return true;
    },
    cambiarPorPagina(cantidad: number): void {
      if (cantidad > 0) porPagina.set(cantidad);
    },
    conservandoPagina(cambio: () => void): void {
      const actual = pagina();
      cambio();
      pagina.set(Math.max(0, Math.min(actual, totalPaginas() - 1)));
    },
  };
}
