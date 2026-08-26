import { convertToParamMap } from '@angular/router';

import { leerParametrosDeHorarios } from './parametros-de-horarios';

/**
 * Spec del lector de los parametros con los que las pantallas de horarios se enlazan entre si.
 *
 * <p>Lo que cubre es lo que una query string escrita a mano puede hacerle a una consulta: un
 * `membershipId=hola` que termina en `NaN` dentro de la URL de la API, o media ventana que
 * mezcla el dia del enlace con el valor por defecto del otro extremo.
 */
describe('leerParametrosDeHorarios', () => {
  it('lee los tres parametros cuando vienen bien escritos', () => {
    const parametros = leerParametrosDeHorarios(
      convertToParamMap({ membershipId: '42', desde: '2026-09-02', hasta: '2026-09-03' }),
    );

    expect(parametros).toEqual({ membershipId: 42, desde: '2026-09-02', hasta: '2026-09-03' });
  });

  it('sin nada en la query string no propone ningun filtro', () => {
    expect(leerParametrosDeHorarios(convertToParamMap({}))).toEqual({
      membershipId: null,
      desde: null,
      hasta: null,
    });
  });

  it('un membershipId que no es un id positivo se descarta y nunca produce un NaN', () => {
    for (const valor of ['hola', '0', '-3', '4.5', '']) {
      expect(
        leerParametrosDeHorarios(convertToParamMap({ membershipId: valor })).membershipId,
        `membershipId=${valor} deberia descartarse`,
      ).toBeNull();
    }
  });

  it('media ventana se descarta entera: mezclarla con el valor por defecto consulta otro periodo', () => {
    const soloDesde = leerParametrosDeHorarios(convertToParamMap({ desde: '2026-09-02' }));

    expect(soloDesde.desde).toBeNull();
    expect(soloDesde.hasta).toBeNull();
  });

  it('una fecha que no es una fecha de calendario descarta la ventana', () => {
    const rota = leerParametrosDeHorarios(
      convertToParamMap({ desde: 'ayer', hasta: '2026-09-03', membershipId: '42' }),
    );

    expect(rota.desde).toBeNull();
    expect(rota.hasta).toBeNull();
    // El profesional si se conserva: son dos filtros independientes.
    expect(rota.membershipId).toBe(42);
  });
});
