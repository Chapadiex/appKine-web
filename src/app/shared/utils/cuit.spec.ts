import { FormControl } from '@angular/forms';

import { esCuitValido, pareceCuit, validadorDeCuit } from './cuit';

describe('cuit', () => {
  it('acepta un CUIT cuyo dígito verificador cierra, con o sin guiones', () => {
    // 20-12345678: 2·5+0·4+1·3+2·2+3·7+4·6+5·5+6·4+7·3+8·2 = 148; 148 mod 11 = 5; 11−5 = 6.
    expect(esCuitValido('20-12345678-6')).toBe(true);
    expect(esCuitValido('20123456786')).toBe(true);
    // 30-71094127: 15+0+21+2+0+54+20+4+6+14 = 136; 136 mod 11 = 4; 11−4 = 7.
    expect(esCuitValido('30-71094127-7')).toBe(true);
    expect(validadorDeCuit(new FormControl('30-71094127-7'))).toBeNull();
  });

  it('rechaza un CUIT con el dígito verificador equivocado', () => {
    expect(esCuitValido('20-12345678-5')).toBe(false);
    expect(esCuitValido('30-71094127-9')).toBe(false);
    expect(validadorDeCuit(new FormControl('30-71094127-9'))).toEqual({ cuit: true });
  });

  it('lo que no parece un CUIT no es válido, pero el validador lo deja pasar', () => {
    expect(pareceCuit('Consultorio Centro')).toBe(false);
    expect(pareceCuit('30-7109412-7')).toBe(false);
    expect(esCuitValido('Consultorio Centro')).toBe(false);
    expect(validadorDeCuit(new FormControl('Consultorio Centro'))).toBeNull();
    expect(validadorDeCuit(new FormControl(''))).toBeNull();
    expect(validadorDeCuit(new FormControl(null))).toBeNull();
  });
});
