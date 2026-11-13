import { AbstractControl, ValidationErrors } from '@angular/forms';

/** Once dígitos, con o sin los dos guiones: "30-71094127-7" o "30710941277". */
const FORMA_DE_CUIT = /^\d{2}-?\d{8}-?\d$/;

/** Pesos del módulo 11 de AFIP, uno por cada uno de los diez primeros dígitos. */
const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Si el texto tiene la forma de un CUIT (todavía no dice si el dígito verificador cierra). */
export function pareceCuit(valor: string): boolean {
  return FORMA_DE_CUIT.test(valor.trim());
}

/**
 * Si el CUIT es válido: tiene la forma y el dígito verificador cierra con el módulo 11 de AFIP.
 *
 * <p>Verificador = 11 − (suma ponderada mod 11); si da 11 el verificador es 0, y si da 10 no existe
 * ningún CUIT con esos diez dígitos.
 */
export function esCuitValido(valor: string): boolean {
  if (!pareceCuit(valor)) {
    return false;
  }
  const digitos = valor.replace(/-/g, '').split('').map(Number);
  const suma = PESOS.reduce((acumulado, peso, indice) => acumulado + peso * digitos[indice], 0);
  const resto = 11 - (suma % 11);
  const verificador = resto === 11 ? 0 : resto;
  return verificador !== 10 && verificador === digitos[10];
}

/**
 * Validador de formulario: marca `{ cuit: true }` sólo cuando el texto tiene forma de CUIT y el
 * dígito verificador no cierra. Vacío o algo que no parece un CUIT pasa: eso lo juzgan otros
 * validadores (el campo puede admitir otro documento).
 */
export function validadorDeCuit(control: AbstractControl<string | null>): ValidationErrors | null {
  const valor = control.value ?? '';
  if (!pareceCuit(valor) || esCuitValido(valor)) {
    return null;
  }
  return { cuit: true };
}
