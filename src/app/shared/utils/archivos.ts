/**
 * Utilidades de archivos descargados, sin reglas de dominio.
 *
 * <p>Las usan las descargas de documentos de persona y de adjuntos clinicos. Vivian copiadas en
 * cada feature y ya divergian: una no sacaba barras del nombre y la otra no aceptaba `utf-8` en
 * minusculas.
 */

/**
 * El nombre de archivo de un `Content-Disposition`, o `null` si no trae uno usable.
 *
 * <p>Prefiere la forma extendida (`filename*=UTF-8''...`, RFC 6266) y cae en la simple si falta o
 * si el porcentaje viene mal formado. <b>Se queda con el nombre y nada mas</b>: barras y caracteres
 * de control afuera, para que un nombre armado a proposito no proponga una ruta al guardar.
 */
export function nombreDeContentDisposition(encabezado: string | null): string | null {
  if (encabezado === null) {
    return null;
  }

  let nombre = '';
  const extendido = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(encabezado);
  if (extendido !== null) {
    try {
      nombre = decodeURIComponent(extendido[1]);
    } catch {
      // Porcentaje mal formado: se sigue con la forma simple en vez de tirar la descarga.
    }
  }
  if (nombre === '') {
    nombre = /filename\s*=\s*"?([^";]+)"?/i.exec(encabezado)?.[1] ?? '';
  }

  // eslint-disable-next-line no-control-regex
  const limpio = nombre.replace(/[\\/\u0000-\u001f]/g, '').trim();
  return limpio === '' ? null : limpio;
}

/** Tamano legible en es-AR: "512 B", "2 kB", "8,4 MB". Vacio si el valor no es un tamano. */
export function tamanoEnPalabras(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${redondear(kb)} kB`;
  }
  return `${redondear(kb / 1024)} MB`;
}

const UN_DECIMAL = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

function redondear(valor: number): string {
  return UN_DECIMAL.format(valor);
}
