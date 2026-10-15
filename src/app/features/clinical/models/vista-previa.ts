/**
 * Vista previa segura de un adjunto clinico (D-a, RF-M25).
 *
 * <p>Un adjunto lo sube una persona y lo mira otra. Si la pantalla renderizara lo que el archivo
 * dice ser, un HTML con un script subido como "informe" correria con la sesion de quien lo abre.
 * Por eso:
 *
 * <ol>
 *   <li><b>Lista blanca, no lista negra.</b> Solo se muestran imagenes rasterizadas y PDF. SVG
 *       queda afuera a proposito: es XML y puede llevar script. Todo lo demas se descarga.</li>
 *   <li><b>El tipo del Blob lo pone esta lista</b>, no el navegador. Un Blob sin tipo, o con uno
 *       que el navegador olfatee, puede terminar interpretado como HTML.</li>
 * </ol>
 */
export type ComoSeMuestra = 'imagen' | 'pdf';

const VISIBLES: ReadonlyMap<string, ComoSeMuestra> = new Map([
  ['image/png', 'imagen'],
  ['image/jpeg', 'imagen'],
  ['image/webp', 'imagen'],
  ['image/gif', 'imagen'],
  ['application/pdf', 'pdf'],
]);

export interface VistaPrevia {
  readonly como: ComoSeMuestra;
  /** El mismo contenido, con el tipo de la lista blanca y no con el que traia. */
  readonly blob: Blob;
}

/**
 * Como mostrar un archivo descargado, o `null` si solo se puede descargar.
 *
 * <p>El tipo es el del Blob, que `HttpClient` toma del `Content-Type` que puso el backend despues
 * de clasificar el archivo por sus bytes. Se normaliza —minusculas, sin parametros como
 * `; charset=`— antes de compararlo. `slice` no copia los bytes: solo cambia el tipo.
 */
export function vistaPreviaDe(blob: Blob): VistaPrevia | null {
  const tipo = blob.type.split(';')[0].trim().toLowerCase();
  const como = VISIBLES.get(tipo);
  return como === undefined ? null : { como, blob: blob.slice(0, blob.size, tipo) };
}
