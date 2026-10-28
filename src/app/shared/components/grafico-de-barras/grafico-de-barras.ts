import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

/** Una barra, ya armada por quien usa el grafico. */
export interface BarraDeGrafico {
  /** Rotulo corto del eje horizontal ("05/10"). */
  readonly etiqueta: string;
  /** Lo que la barra representa, completo ("Semana del 05/10/2026 al 11/10/2026"). */
  readonly detalle: string;
  /** El numero que da la altura. Solo se compara: el grafico no suma nada. */
  readonly valor: number;
  /** El valor como se lee ("$ 15.000,00", "12"). */
  readonly texto: string;
}

/** Cuantos rotulos entran en el eje horizontal sin pisarse, tambien en un telefono. */
const ROTULOS_DEL_EJE = 4;

const COMPACTO = new Intl.NumberFormat('es-AR', {
  notation: 'compact',
  maximumSignificantDigits: 3,
});

let siguienteId = 0;

/**
 * Grafico de barras de una sola serie, sin libreria (DP-45, skill `dataviz`).
 *
 * <p><b>Una serie, un color, un eje.</b> El color es el de accion (`--color-accion-fondo`), que en
 * los dos temas pasa el validador de la skill contra la superficie; los textos van en tinta de
 * texto, nunca en el color de la barra. Sin leyenda: el titulo de la tarjeta dice que se dibuja.
 *
 * <p><b>Accesible sin el dibujo.</b> El lienzo es un grupo con nombre (el resumen que arma quien lo
 * usa) y una sola parada de tabulacion: las flechas recorren las barras y una region viva lee el
 * valor de la barra activa, lo mismo que muestra el globo al pasar el puntero. Debajo, los mismos
 * datos en una tabla plegada: el globo mejora, nunca es la unica forma de leer un valor.
 *
 * <p><b>Sin medir el contenedor.</b> Las barras son columnas de una grilla con su altura en
 * porcentaje, asi que el grafico sigue el ancho sin `ResizeObserver`. Con muchas barras en una
 * pantalla angosta, el lienzo se desplaza de costado dentro de su marco y la pagina no.
 *
 * <p><b>No sabe de dominio.</b> Recibe las barras con su texto ya formateado.
 */
@Component({
  selector: 'app-grafico-de-barras',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './grafico-de-barras.html',
  styleUrl: './grafico-de-barras.css',
})
export class GraficoDeBarras {
  readonly barras = input.required<readonly BarraDeGrafico[]>();
  /** Nombre accesible del lienzo: que se dibuja, el periodo y el total. */
  readonly descripcion = input.required<string>();
  readonly encabezadoPeriodo = input('Período');
  readonly encabezadoValor = input('Valor');
  /** Si todas las barras valen cero no se dibuja nada: se dice esto. */
  readonly textoSinValores = input('Sin valores en el período.');

  protected readonly id = `grafico-${siguienteId++}`;
  protected readonly activa = signal<number | null>(null);

  /** Tope del eje: un numero redondo por encima del maximo, para que las marcas sean legibles. */
  protected readonly tope = computed(() =>
    techoRedondo(Math.max(0, ...this.barras().map((b) => b.valor))),
  );

  protected readonly sinValores = computed(() => this.barras().every((b) => b.valor <= 0));

  protected readonly marcas = computed(() => {
    const tope = this.tope();
    const medio = tope / 2;
    const valores = Number.isInteger(medio) ? [0, medio, tope] : [0, tope];
    return valores.map((valor) => ({
      valor,
      alto: (valor / tope) * 100,
      texto: COMPACTO.format(valor),
    }));
  });

  protected readonly columnas = computed(() => {
    const tope = this.tope();
    return this.barras().map((barra) => ({
      ...barra,
      // Las series son sumas: un negativo no tiene donde dibujarse y queda en la base.
      alto: (Math.max(0, barra.valor) / tope) * 100,
    }));
  });

  /**
   * Rotulos del eje horizontal: el primero, el ultimo y los del medio repartidos parejo. Repartir
   * por posicion (y no "uno cada N") evita que el ultimo quede pegado al anterior y lo pise.
   */
  protected readonly rotulos = computed(() => {
    const total = this.barras().length;
    if (total === 0) {
      return [];
    }
    const ultimo = total - 1;
    // Nunca mas tramos que barras: asi dos rotulos no caen en la misma.
    const tramos = Math.min(ultimo, ROTULOS_DEL_EJE - 1);
    const indices =
      tramos === 0
        ? [0]
        : Array.from({ length: tramos + 1 }, (_, j) => Math.round((j * ultimo) / tramos));
    return indices.map((i) => ({
      texto: this.barras()[i].etiqueta,
      izquierda: ((i + 0.5) / total) * 100,
      alineacion: i === 0 ? 'inicio' : i === ultimo && total > 1 ? 'fin' : 'centro',
    }));
  });

  protected readonly lectura = computed(() => {
    const i = this.activa();
    const barra = i === null ? undefined : this.barras()[i];
    return barra === undefined ? '' : `${barra.detalle}: ${barra.texto}`;
  });

  /** Donde va el globo, y hacia que lado se abre para no salirse del lienzo. */
  protected readonly globo = computed(() => {
    const i = this.activa();
    const total = this.barras().length;
    if (i === null || i >= total) {
      return null;
    }
    const izquierda = ((i + 0.5) / total) * 100;
    const corrimiento = izquierda < 20 ? '0' : izquierda > 80 ? '-100%' : '-50%';
    return { barra: this.barras()[i], izquierda, corrimiento };
  });

  protected activar(indice: number): void {
    this.activa.set(indice);
  }

  protected soltar(): void {
    this.activa.set(null);
  }

  /** Al entrar con el teclado, la barra mas reciente: es la que se busca primero. */
  protected enfocar(): void {
    if (this.activa() === null && this.barras().length > 0) {
      this.activa.set(this.barras().length - 1);
    }
  }

  protected teclear(evento: KeyboardEvent): void {
    const total = this.barras().length;
    if (total === 0) {
      return;
    }
    const actual = this.activa() ?? total - 1;
    const destino: Record<string, number> = {
      ArrowLeft: Math.max(0, actual - 1),
      ArrowRight: Math.min(total - 1, actual + 1),
      Home: 0,
      End: total - 1,
    };
    if (evento.key in destino) {
      evento.preventDefault();
      this.activa.set(destino[evento.key]);
    }
  }
}

/** El menor 1, 2, 2,5 o 5 por una potencia de diez que no queda debajo de `maximo`. */
export function techoRedondo(maximo: number): number {
  if (!(maximo > 0)) {
    return 1;
  }
  const potencia = 10 ** Math.floor(Math.log10(maximo));
  for (const paso of [1, 2, 2.5, 5]) {
    if (paso * potencia >= maximo) {
      return paso * potencia;
    }
  }
  return 10 * potencia;
}
