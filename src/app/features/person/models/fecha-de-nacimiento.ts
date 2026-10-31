import { AbstractControl, ValidationErrors } from '@angular/forms';

/** Antes de esto es un error de tipeo: "52" en el campo del año da el año 52, no 1952. */
export const FECHA_DE_NACIMIENTO_MINIMA = '1900-01-01';

/**
 * Una fecha de nacimiento posible, o ninguna: es opcional.
 *
 * <p>El backend sólo exige que sea anterior a hoy, así que el año 52 pasa y queda guardado. Compara
 * el ISO como texto: el `input` de fecha siempre lo da con el año completo.
 */
export function fechaDeNacimientoPosible(
  control: AbstractControl<string>,
): ValidationErrors | null {
  const fecha = control.value;
  if (!fecha) {
    return null;
  }
  const ahora = new Date();
  const hoy = [
    String(ahora.getFullYear()).padStart(4, '0'),
    String(ahora.getMonth() + 1).padStart(2, '0'),
    String(ahora.getDate()).padStart(2, '0'),
  ].join('-');
  return fecha < FECHA_DE_NACIMIENTO_MINIMA || fecha >= hoy
    ? { fechaDeNacimientoImposible: true }
    : null;
}
