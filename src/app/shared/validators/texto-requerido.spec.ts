import { FormControl } from '@angular/forms';

import { textoRequerido } from './texto-requerido';

describe('textoRequerido', () => {
  it('rechaza el texto de solo espacios, que es lo que `Validators.required` deja pasar', () => {
    // El hueco exacto: el control quedaba valido, la pantalla mandaba el valor recortado y el
    // backend devolvia un 400 sobre una restriccion de base.
    for (const blanco of ['   ', '\t', '\n', ' \t ']) {
      expect(textoRequerido(new FormControl(blanco))).toEqual({ required: true });
    }
  });

  it('rechaza el vacio y acepta el texto con contenido, aunque tenga espacios alrededor', () => {
    expect(textoRequerido(new FormControl(''))).toEqual({ required: true });
    expect(textoRequerido(new FormControl('Sede Centro'))).toBeNull();
    // Recortar es cosa de quien arma el cuerpo: aca solo se decide si hay dato.
    expect(textoRequerido(new FormControl('  Sede Centro  '))).toBeNull();
  });

  it('devuelve la clave `required`, para que las plantillas ya escritas sigan diciendo lo suyo', () => {
    const control = new FormControl('   ', { validators: [textoRequerido] });

    expect(control.invalid).toBe(true);
    expect(control.hasError('required')).toBe(true);
  });

  it('delega en Validators.required lo que no es texto', () => {
    // Un select sin elegir, una casilla, un numero: la obligatoriedad de eso ya la sabe Angular
    // y duplicarla aca seria reimplementarla peor.
    expect(textoRequerido(new FormControl(null))).toEqual({ required: true });
    expect(textoRequerido(new FormControl([]))).toEqual({ required: true });
    expect(textoRequerido(new FormControl(0))).toBeNull();
    expect(textoRequerido(new FormControl(false))).toBeNull();
  });
});
