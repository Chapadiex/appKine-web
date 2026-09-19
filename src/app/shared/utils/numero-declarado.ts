/**
 * El numero que el usuario declaro en un campo numerico, o `null` si no declaro ninguno.
 *
 * <p><b>Un `<input type="number">` vacio NO entrega `''`.</b> Angular le pone el
 * `NumberValueAccessor`, que escribe `null` en el control cuando el campo queda vacio —aunque el
 * grupo sea `nonNullable` y el tipo declarado del control diga `string`—. Por eso la guarda que
 * todas estas pantallas usaban, `valores.campo !== ''`, no alcanza: `null !== ''` es verdadero,
 * `Number(null)` es `0` y `0` es finito, asi que <b>el campo borrado viajaba como un cero
 * deliberado</b>.
 *
 * <p>Lo que eso produce depende del campo, y ninguno de los desenlaces es un error que el
 * operador pueda interpretar: una duracion de `0` es un 400 sobre un check de la base, un precio
 * de `0` es una oferta gratis guardada sin aviso, y un tope de `0` sesiones por mes es un
 * convenio que no autoriza ninguna.
 *
 * <p>Vive en `shared/utils` y no en una pantalla porque el hueco no era de una: es de como
 * Angular representa un numero vacio, y aparece en cada formulario que tenga un campo numerico
 * opcional.
 */
export function numeroDeclarado(valor: unknown): number | null {
  if (valor === null || valor === undefined) {
    return null;
  }
  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? valor : null;
  }
  if (typeof valor !== 'string' || valor.trim() === '') {
    return null;
  }
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}
