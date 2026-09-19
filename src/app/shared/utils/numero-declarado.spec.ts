import { FormControl, FormGroup } from '@angular/forms';

import { numeroDeclarado } from './numero-declarado';

describe('numeroDeclarado', () => {
  it('trata como "sin declarar" el null que deja un input numerico vaciado', () => {
    // Es el caso que existe para atajar: la guarda `valor !== ''` lo daba por declarado,
    // `Number(null)` es 0 y 0 es finito, asi que el campo borrado viajaba como un cero.
    expect(numeroDeclarado(null)).toBeNull();
    expect(numeroDeclarado(undefined)).toBeNull();
    expect(numeroDeclarado('')).toBeNull();
    expect(numeroDeclarado('   ')).toBeNull();
  });

  it('devuelve el numero cuando hay uno, en texto o ya convertido', () => {
    expect(numeroDeclarado('45')).toBe(45);
    expect(numeroDeclarado(' 45 ')).toBe(45);
    expect(numeroDeclarado('0')).toBe(0);
    expect(numeroDeclarado(45)).toBe(45);
    expect(numeroDeclarado(0)).toBe(0);
  });

  it('un valor que no es un numero no se cuela como NaN ni como cero', () => {
    expect(numeroDeclarado('abc')).toBeNull();
    expect(numeroDeclarado(Number.NaN)).toBeNull();
    expect(numeroDeclarado(Number.POSITIVE_INFINITY)).toBeNull();
    expect(numeroDeclarado({})).toBeNull();
    expect(numeroDeclarado(true)).toBeNull();
  });

  it('el null lo escribe Angular, no el codigo de la pantalla', () => {
    // La demostracion del mecanismo: un control atado a un <input type="number"> recibe `null`
    // del NumberValueAccessor cuando el campo queda vacio, aunque su tipo declarado sea string.
    const grupo = new FormGroup({ duracion: new FormControl<string>('45', { nonNullable: true }) });
    grupo.controls.duracion.setValue(null as unknown as string);

    const valores = grupo.getRawValue();
    expect(valores.duracion !== '').toBe(true);
    expect(Number(valores.duracion)).toBe(0);
    expect(numeroDeclarado(valores.duracion)).toBeNull();
  });
});
