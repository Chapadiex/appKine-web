import { TipoDeAlerta } from '../../../shared/components/alerta/alerta';
import { CausaContracting } from '../models/contracting-errors';

/**
 * Severidad de la alerta de un formulario de contratacion (UX-12, 28/10/2026).
 *
 * <p>Chocar con algo que ya existe —un codigo o un nombre en uso, un periodo que se superpone, una
 * version que otro cambio, una baja que ya estaba hecha— no es un fallo: es una coincidencia que el
 * usuario resuelve ahi mismo (otro codigo, cerrar la vigencia del anterior, releer). Va como
 * advertencia. Todo lo demas es un error.
 */
export function tipoDeAlertaContracting(causa: CausaContracting | null): TipoDeAlerta {
  switch (causa) {
    case 'codigo-repetido':
    case 'nombre-repetido':
    case 'cuit-repetido':
    case 'solapamiento':
    case 'concurrencia':
    case 'ya-dada-de-baja':
      return 'advertencia';
    default:
      return 'error';
  }
}
