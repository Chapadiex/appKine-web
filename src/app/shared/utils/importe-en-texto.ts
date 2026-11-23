/**
 * Importes tipeados en un campo de texto, con el formato argentino: punto para los miles y coma
 * para los decimales ("10.000.000,00", "8.500,50").
 *
 * <p>Un `<input type="number">` no muestra separador de miles y con montos grandes es facil leer
 * mal un cero de mas. El campo es de texto con `inputmode="decimal"`: se escribe libre, al salir
 * se muestra formateado con {@link formatearImporte} y al enviar se lee con {@link leerImporte}.
 */

const FORMATO = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * El numero que representa lo tipeado, o `null` si esta vacio o no es un importe.
 *
 * <p>Acepta las dos costumbres: "10.000,50" (miles con punto, decimales con coma) y "10000.50"
 * (punto decimal, como lo escribe una calculadora). Con coma presente, los puntos son miles. Sin
 * coma, un punto seguido de exactamente tres digitos es de miles ("10.000" son diez mil, que es
 * como se lee en Argentina); cualquier otro punto es decimal.
 */
export function leerImporte(texto: string | null | undefined): number | null {
  if (texto === null || texto === undefined) {
    return null;
  }
  const limpio = texto.replace(/[\s$]/g, '');
  if (limpio === '') {
    return null;
  }
  let normalizado: string;
  if (limpio.includes(',')) {
    normalizado = limpio.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(limpio)) {
    normalizado = limpio.replace(/\./g, '');
  } else {
    normalizado = limpio;
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalizado)) {
    return null;
  }
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

/** El importe con formato argentino y siempre dos decimales: "10.000.000,00" o "8.500,50". */
export function formatearImporte(valor: number | null | undefined): string {
  return valor === null || valor === undefined || !Number.isFinite(valor)
    ? ''
    : FORMATO.format(valor);
}

/**
 * Para el `(blur)` de un campo de importe: si lo tipeado se entiende, lo reescribe formateado; si
 * no, lo deja como esta para que la validacion lo marque.
 */
export function reformatearImporte(texto: string): string {
  const numero = leerImporte(texto);
  return numero === null ? texto : formatearImporte(numero);
}
