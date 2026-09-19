import { AbstractControl, ValidationErrors, Validators } from '@angular/forms';

/**
 * Obligatoriedad real de un campo de texto: <b>en blanco no alcanza</b>.
 *
 * <p>`Validators.required` solo mira que el valor no sea vacio, nulo o una lista vacia: para el,
 * `'   '` es un valor presente y el formulario queda valido. Despues, cada pantalla recorta el
 * texto antes de armar el cuerpo —`valores.name.trim()`— y manda una cadena vacia en un campo que
 * el contrato declara obligatorio. El backend responde 400 sobre una restriccion de base que el
 * operador no puede asociar a ningun campo de la pantalla, y el mensaje que la pantalla ya tenia
 * escrito -"El espacio necesita un nombre."- nunca se muestra porque el control nunca fue
 * invalido.
 *
 * <p>Angular no trae un validador de no-blanco, asi que este es el del repositorio. Se aplica a
 * <b>todos</b> los campos de texto obligatorios, no a los tres donde el sintoma se vio primero: el
 * hueco no era de esas pantallas, era de `Validators.required`.
 *
 * <p><b>Devuelve la clave `required`</b>, no una propia. Las plantillas y los `mostrarErrorX()`
 * existentes ya redactan el mensaje de obligatoriedad para ese error, y un campo con espacios es
 * exactamente el mismo problema para quien lo lee: falta el dato. Una clave nueva obligaria a
 * tocar cada plantilla para decir lo mismo.
 *
 * <p>No se aplica a contrasenas: ahi el espacio es un caracter como cualquier otro y recortarlo
 * para validar insinuaria que tambien se recorta para autenticar, que no es el caso.
 */
export function textoRequerido(control: AbstractControl): ValidationErrors | null {
  const valor: unknown = control.value;
  if (typeof valor !== 'string') {
    // Un select con `null`, un numero, una casilla: la obligatoriedad de eso ya la sabe Angular.
    return Validators.required(control);
  }
  return valor.trim() === '' ? { required: true } : null;
}
