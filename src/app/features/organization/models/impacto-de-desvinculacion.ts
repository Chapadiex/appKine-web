import { DesvinculacionImpactoResponse } from '../../../api/generated/model/desvinculacion-impacto-response';
import { formatearInstante } from '../../../shared/utils/instantes';

/**
 * Lo que la pantalla de colaboradores sabe del impacto de una desvinculacion (RN-M05-004).
 *
 * <p>`cargando` mientras vuelve la sonda, `error` si no se pudo consultar. El error <b>no
 * bloquea</b> la revocacion: el backend tampoco lo hace, y no saber cuanto queda pendiente no
 * es motivo para impedir registrar que alguien se fue. Lo que si hace es decirlo.
 */
export type ImpactoDeDesvinculacion =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error' }
  | { readonly tipo: 'listo'; readonly respuesta: DesvinculacionImpactoResponse };

/**
 * La frase principal del aviso, o `null` si no queda nada pendiente.
 *
 * <p>`tipo` llega en plural y en lenguaje del usuario ("turnos", "bloques de disponibilidad"):
 * se usa tal cual y no se traduce aca, para no inventar una lista de valores que el contrato no
 * declara.
 */
export function resumenDeImpacto(respuesta: DesvinculacionImpactoResponse): string | null {
  const cantidad = respuesta.count ?? 0;
  if (cantidad <= 0) {
    return null;
  }
  const que = respuesta.tipo?.trim() || 'pendientes';
  const desde = formatearInstante(respuesta.desde);
  return desde === null
    ? `Quedan ${cantidad} ${que} a su nombre.`
    : `Quedan ${cantidad} ${que} a su nombre, el primero el ${desde}.`;
}
