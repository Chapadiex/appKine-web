/**
 * Entregarle un archivo al navegador. Sin reglas de dominio: sirve para un adjunto, un CSV o
 * cualquier contenido que el backend mande para guardar.
 */

/**
 * El nombre del archivo declarado en `Content-Disposition`, o `null`.
 *
 * <p>Se leen las dos formas —`filename*=UTF-8''...` primero, `filename="..."` despues— porque un
 * nombre con acentos viaja en la primera y en la segunda queda transliterado o roto. Si ninguna
 * casa se devuelve `null` y quien llama usa su propio nombre: inventar uno aca seria peor.
 */
export function nombreDelEncabezado(encabezado: string | null): string | null {
  if (encabezado === null) {
    return null;
  }

  const extendido = /filename\*=UTF-8''([^;]+)/i.exec(encabezado);
  if (extendido !== null) {
    try {
      return decodeURIComponent(extendido[1]);
    } catch {
      // Porcentaje mal formado. Se sigue con la forma simple en vez de tirar la descarga.
    }
  }

  const simple = /filename="?([^";]+)"?/i.exec(encabezado);
  return simple === null ? null : simple[1];
}

/**
 * Guarda `contenido` con `nombre` por medio de un enlace temporal.
 *
 * <p>El `objectURL` <b>se revoca siempre</b>, incluso si el click fallo: sin eso el navegador
 * retiene el contenido completo hasta que se cierra la pestaña.
 */
export function guardarComoArchivo(contenido: Blob, nombre: string): void {
  const url = URL.createObjectURL(contenido);
  try {
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    enlace.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
