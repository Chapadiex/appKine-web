import { rutaDePantalla } from './ruta-de-pantalla';

describe('rutaDePantalla', () => {
  it('quita la query y el fragmento', () => {
    expect(rutaDePantalla('/pacientes?q=Perez&pagina=2')).toBe('/pacientes');
    expect(rutaDePantalla('/pacientes/12/resumen#coberturas')).toBe('/pacientes/12/resumen');
    expect(rutaDePantalla('/caja')).toBe('/caja');
  });
});
