/**
 * Prepara un archivo para subirlo como adjunto: el servidor acepta PDF, JPG y PNG de hasta 10 MB.
 *
 * <p>Una foto de celular suele llegar como HEIC o WebP, o pesar mas de 10 MB. Toda imagen que no
 * sea un JPG o PNG chico se redibuja en un canvas y sale como JPG de hasta {@link LADO_MAXIMO}
 * pixeles por lado: legible para un estudio o una receta, y liviana. Los PDF pasan sin tocar.
 *
 * <p>Si el navegador no sabe abrir la imagen (HEIC en Chrome, por ejemplo) devuelve un error con
 * un texto para mostrar: la salida es sacar la foto desde la camara de la pantalla, que da JPG.
 */
export const LADO_MAXIMO = 2000;
const CALIDAD_JPEG = 0.85;
const TOPE_SIN_TOCAR = 3 * 1024 * 1024;

export class ImagenNoLegible extends Error {
  constructor() {
    super(
      'No pudimos abrir esa imagen (puede ser HEIC). Sacá la foto con el botón «Sacar foto» o guardala como JPG.',
    );
  }
}

export async function prepararArchivoParaSubir(archivo: File): Promise<File> {
  if (
    !archivo.type.startsWith('image/') &&
    !/\.(heic|heif|webp|gif|bmp|avif)$/i.test(archivo.name)
  ) {
    return archivo;
  }
  const yaSirve =
    (archivo.type === 'image/jpeg' || archivo.type === 'image/png') &&
    archivo.size <= TOPE_SIN_TOCAR;
  if (yaSirve) {
    return archivo;
  }

  let imagen: ImageBitmap;
  try {
    imagen = await createImageBitmap(archivo);
  } catch {
    throw new ImagenNoLegible();
  }
  const escala = Math.min(1, LADO_MAXIMO / Math.max(imagen.width, imagen.height));
  const ancho = Math.round(imagen.width * escala);
  const alto = Math.round(imagen.height * escala);
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const contexto = lienzo.getContext('2d');
  if (contexto === null) {
    throw new ImagenNoLegible();
  }
  // Fondo blanco: un PNG o WebP con transparencia no queda negro al pasar a JPG.
  contexto.fillStyle = '#ffffff';
  contexto.fillRect(0, 0, ancho, alto);
  contexto.drawImage(imagen, 0, 0, ancho, alto);
  imagen.close();

  const blob = await new Promise<Blob | null>((resolver) =>
    lienzo.toBlob(resolver, 'image/jpeg', CALIDAD_JPEG),
  );
  if (blob === null) {
    throw new ImagenNoLegible();
  }
  const nombre = archivo.name.replace(/\.[^.]+$/, '') || 'foto';
  return new File([blob], `${nombre}.jpg`, { type: 'image/jpeg' });
}
