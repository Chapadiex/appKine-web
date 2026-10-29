import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  ViewEncapsulation,
} from '@angular/core';

/** Cuantas filas por pagina se pueden elegir. La primera es el valor por defecto de AKINE. */
export const FILAS_POR_PAGINA = [10, 25, 50, 100] as const;

/** Las filas por pagina con las que arranca toda tabla de AKINE. */
export const FILAS_POR_PAGINA_INICIAL = FILAS_POR_PAGINA[0];

/** Un boton del paginador: una pagina (base 0) o un salto ("…"). */
type Paso = { readonly tipo: 'pagina'; readonly numero: number } | { readonly tipo: 'salto' };

/**
 * Pie de una tabla paginada (UX-14, regla de tablas): en una sola fila y siempre en el mismo
 * lugar, debajo de la tabla,
 *
 * <pre>
 *   Mostrando 1–10 de 87        Filas por página [10 ▾]        ‹ 1 2 3 … 9 ›
 * </pre>
 *
 * <p><b>No sabe que se esta paginando.</b> Recibe el estado -pagina actual en base 0, total de
 * paginas, total de filas y filas por pagina- y emite lo que se pide. Quien la usa decide que
 * hacer: recargar del servidor (con `page` y `size`), o mover una `tablaLocal` (ver
 * `app-pie-de-tabla`, que la cablea sola).
 *
 * <p><b>Cuando no se dibuja.</b> Sin filas no hay nada que paginar: el estado vacio es de la
 * pantalla. Con `total` y menos filas que la opcion mas chica, queda solo el resumen ("Mostrando
 * 1–4 de 4"): un selector de 10/25/50/100 para cuatro filas es ruido. Sin `total` (un listado que
 * no lo conoce) se comporta como antes: solo los botones, y solo si hay mas de una pagina.
 *
 * <p><b>Accesibilidad.</b> El `nav` lleva un `aria-label` propio de cada listado; la pagina actual
 * se marca con `aria-current="page"`; las flechas tienen nombre ("Página anterior"); el resumen es
 * texto real y anuncia los cambios (`aria-live`).
 */
@Component({
  selector: 'akine-paginacion, app-paginacion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './paginacion.css',
  templateUrl: './paginacion.html',
  host: { class: 'paginacion-pie' },
})
export class Paginacion {
  /** Pagina mostrada, en base 0 -como la pide el backend-. */
  readonly paginaActual = input.required<number>();

  /** Cuantas paginas hay en total. */
  readonly totalPaginas = input.required<number>();

  /** `aria-label` del `nav`. Ej: "Páginas de sedes". */
  readonly etiqueta = input.required<string>();

  /** Total de filas (sin paginar). Con el, el pie dice "Mostrando 1–10 de 87". */
  readonly total = input<number | null>(null);

  /** Filas por pagina. Con el (y con `total`), el pie ofrece cambiarlo. */
  readonly porPagina = input<number | null>(null);

  /** Pagina pedida, ya validada contra los limites. */
  readonly cambioDePagina = output<number>();

  /** Filas por pagina elegidas. Quien escucha vuelve a la primera pagina. */
  readonly cambioDePorPagina = output<number>();

  protected readonly opciones = FILAS_POR_PAGINA;

  protected readonly visible = computed(() => {
    const total = this.total();
    return total === null ? this.totalPaginas() > 1 : total > 0;
  });

  protected readonly resumen = computed(() => {
    const total = this.total();
    const porPagina = this.porPagina();
    if (total === null || total === 0) {
      return null;
    }
    if (porPagina === null) {
      return `${total} ${total === 1 ? 'resultado' : 'resultados'}`;
    }
    const desde = this.paginaActual() * porPagina + 1;
    const hasta = Math.min(total, desde + porPagina - 1);
    return `Mostrando ${desde}–${hasta} de ${total}`;
  });

  protected readonly conSelector = computed(() => {
    const total = this.total();
    return total !== null && this.porPagina() !== null && total > FILAS_POR_PAGINA[0];
  });

  /** Primera, ultima y las vecinas de la actual; lo demas, un salto ("…"). */
  protected readonly pasos = computed<readonly Paso[]>(() => {
    const total = this.totalPaginas();
    const actual = this.paginaActual();
    if (total <= 1) {
      return [];
    }
    const numeros = new Set<number>([0, total - 1, actual - 1, actual, actual + 1]);
    if (actual <= 2) [1, 2, 3].forEach((n) => numeros.add(n));
    if (actual >= total - 3) [total - 2, total - 3, total - 4].forEach((n) => numeros.add(n));
    const ordenados = [...numeros].filter((n) => n >= 0 && n < total).sort((a, b) => a - b);
    const pasos: Paso[] = [];
    ordenados.forEach((numero, indice) => {
      if (indice > 0 && numero - ordenados[indice - 1] > 1) {
        pasos.push({ tipo: 'salto' });
      }
      pasos.push({ tipo: 'pagina', numero });
    });
    return pasos;
  });

  /**
   * Emite solo si la pagina existe: un `disabled` es una decision de la vista y un click
   * sintetico puede saltearlo, y una pagina fuera de rango es un `400` o una lista vacia que se
   * lee como "no hay nada".
   */
  protected ir(numero: number): void {
    if (numero < 0 || numero >= this.totalPaginas() || numero === this.paginaActual()) {
      return;
    }
    this.cambioDePagina.emit(numero);
  }

  protected elegirPorPagina(valor: string): void {
    const porPagina = Number(valor);
    if (FILAS_POR_PAGINA.includes(porPagina as (typeof FILAS_POR_PAGINA)[number])) {
      this.cambioDePorPagina.emit(porPagina);
    }
  }
}
