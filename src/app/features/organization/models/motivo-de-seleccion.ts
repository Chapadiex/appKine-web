/**
 * Por que la aplicacion mando al usuario a elegir contexto otra vez.
 *
 * <p><b>Por que hace falta.</b> Llegar al selector de contexto sin explicacion, en el medio
 * de otra tarea, se lee como una falla: el usuario estaba administrando sedes y de golpe le
 * piden que elija donde trabajar. El motivo viaja en la URL para que la pantalla pueda
 * decir que paso, en lugar de dejarlo deducir.
 *
 * <p>El caso real que existe hoy es el de la sede dada de baja: una sede inactiva no recibe
 * operaciones nuevas, asi que un contexto parado sobre ella deja de servir en el mismo
 * instante en que se la desactiva. Sin este aviso, el usuario veria una lista de contextos
 * donde falta el suyo y no sabria por que.
 *
 * <p><b>Vive en `features/organization` y no en `core/`.</b> Lo escribe la pantalla de
 * sedes y lo lee la de seleccion de contexto: las dos son de esta feature, asi que no hay
 * import cruzado. El nombre de la ruta destino si es de `core/` (`RUTA_SELECTOR_CONTEXTO`),
 * porque ahi el acuerdo es con los guards.
 */

/** Query param con el que se explica por que se volvio al selector de contexto. */
export const PARAM_MOTIVO = 'motivo';

/** La sede del contexto activo quedo inactiva: hay que elegir otra. */
export const MOTIVO_SEDE_INACTIVA = 'sede-inactiva';

/**
 * Texto a mostrar para un motivo, o `null` si no se reconoce.
 *
 * <p>Devuelve `null` -y no el valor crudo- ante cualquier otra cosa: el query param lo
 * puede escribir cualquiera en la barra de direcciones, y pintar en pantalla un texto que
 * viene de la URL es una inyeccion de contenido con la firma de la aplicacion.
 */
export function avisoDelMotivo(motivo: string | null): string | null {
  return motivo === MOTIVO_SEDE_INACTIVA
    ? 'La sede en la que estabas trabajando quedo dada de baja, asi que no admite operaciones ' +
        'nuevas. Elegi otra sede para seguir trabajando.'
    : null;
}
