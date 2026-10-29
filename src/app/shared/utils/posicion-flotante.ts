/** Lado del ancla hacia el que se abre un panel flotante. */
export type LadoFlotante = 'derecha' | 'izquierda' | 'abajo' | 'arriba';

/** Orden en que se prueban los lados: el primero donde el panel entra entero gana. */
const LADOS: readonly LadoFlotante[] = ['derecha', 'izquierda', 'abajo', 'arriba'];

/** Distancia minima del panel a los bordes de la ventana. */
const MARGEN_PX = 10;

/** Espacio entre el ancla y el panel: ahi va la flecha. */
const SEPARACION_PX = 10;

/** La flecha no se acerca a una esquina redondeada del panel mas que esto. */
const MARGEN_FLECHA_PX = 16;

/** Donde poner el panel, en coordenadas de la ventana (`position: fixed`). */
export interface PosicionFlotante {
  readonly lado: LadoFlotante;
  readonly top: number;
  readonly left: number;
  /** Alto al que hay que acotar el panel porque no entra entero en ningun lado, o `null`. */
  readonly altoMaximo: number | null;
  /** Distancia de la flecha al borde del panel sobre el eje que comparte con el ancla. */
  readonly flecha: number;
}

type Caja = Pick<DOMRect, 'top' | 'left' | 'right' | 'bottom'>;

const acotar = (valor: number, minimo: number, maximo: number): number =>
  Math.min(Math.max(valor, minimo), maximo);

const esHorizontal = (lado: LadoFlotante): boolean => lado === 'derecha' || lado === 'izquierda';

/**
 * Ubica un panel flotante contra su ancla sin que se salga de la ventana (flip y shift).
 *
 * <p>Prueba derecha, izquierda, abajo y arriba, y se queda con el primer lado donde el panel
 * entra entero. Sobre el otro eje lo centra en el ancla y lo corre lo justo para que no toque los
 * bordes. Si no entra entero en ningun lado (una pantalla baja con un texto largo), va abajo o
 * arriba, donde haya mas lugar, acotado a ese alto: el contenido se desplaza adentro del panel.
 *
 * <p>Es una funcion pura para que la decision se pueda probar sin un navegador: quien la usa mide
 * el ancla y el panel y aplica el resultado.
 */
export function posicionFlotante(
  ancla: Caja,
  ancho: number,
  alto: number,
  ventana: { readonly ancho: number; readonly alto: number },
): PosicionFlotante {
  const espacio: Record<LadoFlotante, number> = {
    derecha: ventana.ancho - MARGEN_PX - (ancla.right + SEPARACION_PX),
    izquierda: ancla.left - SEPARACION_PX - MARGEN_PX,
    abajo: ventana.alto - MARGEN_PX - (ancla.bottom + SEPARACION_PX),
    arriba: ancla.top - SEPARACION_PX - MARGEN_PX,
  };
  const entra = (lado: LadoFlotante): boolean =>
    esHorizontal(lado)
      ? ancho <= espacio[lado] && alto <= ventana.alto - 2 * MARGEN_PX
      : alto <= espacio[lado] && ancho <= ventana.ancho - 2 * MARGEN_PX;

  let lado = LADOS.find(entra);
  let altoMaximo: number | null = null;
  if (lado === undefined) {
    lado = espacio.abajo >= espacio.arriba ? 'abajo' : 'arriba';
    altoMaximo = Math.max(espacio[lado], 0);
    alto = Math.min(alto, altoMaximo);
  }

  const centroX = (ancla.left + ancla.right) / 2;
  const centroY = (ancla.top + ancla.bottom) / 2;
  let top: number;
  let left: number;
  if (esHorizontal(lado)) {
    left = lado === 'derecha' ? ancla.right + SEPARACION_PX : ancla.left - SEPARACION_PX - ancho;
    top = acotar(centroY - alto / 2, MARGEN_PX, ventana.alto - MARGEN_PX - alto);
  } else {
    top = lado === 'abajo' ? ancla.bottom + SEPARACION_PX : ancla.top - SEPARACION_PX - alto;
    left = acotar(centroX - ancho / 2, MARGEN_PX, ventana.ancho - MARGEN_PX - ancho);
  }

  // La flecha apunta al centro del ancla aunque el panel se haya corrido.
  const flecha = esHorizontal(lado)
    ? acotar(centroY - top, MARGEN_FLECHA_PX, alto - MARGEN_FLECHA_PX)
    : acotar(centroX - left, MARGEN_FLECHA_PX, ancho - MARGEN_FLECHA_PX);

  return { lado, top, left, altoMaximo, flecha };
}
