import { LibroResponseEstadoEnum } from '../../../api/generated/model/libro-response';

/**
 * Textos de los libros de la biblioteca. La lista sale del enum generado: si el backend agrega
 * un estado, el filtro lo ofrece solo.
 */
export const ESTADOS_DE_LIBRO: readonly LibroResponseEstadoEnum[] =
  Object.values(LibroResponseEstadoEnum);

export function estadoDeLibroEnPalabras(estado: string | undefined): string {
  switch (estado) {
    case LibroResponseEstadoEnum.PENDIENTE:
      return 'En cola';
    case LibroResponseEstadoEnum.PROCESANDO:
      return 'Procesando';
    case LibroResponseEstadoEnum.LISTO:
      return 'Listo';
    case LibroResponseEstadoEnum.ERROR:
      return 'Con error';
    case LibroResponseEstadoEnum.INACTIVO:
      return 'Inactivo';
    default:
      return estado ?? '';
  }
}

/** Reusa las marcas del design system, sin colores propios. */
export function claseDeEstadoDeLibro(estado: string | undefined): string {
  switch (estado) {
    case LibroResponseEstadoEnum.LISTO:
      return 'marca-estado marca-estado--activa';
    case LibroResponseEstadoEnum.ERROR:
      return 'marca-estado marca-estado--revocada';
    default:
      return 'marca-estado marca-estado--suspendida';
  }
}
