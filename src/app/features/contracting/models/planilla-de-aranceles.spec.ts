import {
  MAXIMO_DE_FILAS,
  PLANILLA_DE_EJEMPLO,
  motivoDeFilaRechazada,
  parsearPlanilla,
} from './planilla-de-aranceles';

const CABECERA =
  'codigoPractica;importeTotal;importeFinanciador;coseguro;vigenciaDesde;vigenciaHasta';

/**
 * Spec del parser de la planilla de aranceles (RF-M16-007, AKINE-B-7).
 *
 * <p>Lo que importa: que la fila N de la planilla sea la fila N del lote (el backend responde por
 * posicion), que el formato malo se detenga ANTES de gastar un preview, y que un importe con mas
 * de dos decimales no viaje redondeado.
 */
describe('parsearPlanilla', () => {
  it('el ejemplo de la pantalla se parsea entero, con coma decimal y sin fin de vigencia', () => {
    const { filas, errores, lineas } = parsearPlanilla(PLANILLA_DE_EJEMPLO);

    expect(errores).toEqual([]);
    expect(lineas).toEqual([2, 3]);
    expect(filas).toEqual([
      {
        codigoPractica: 'KIN-01',
        importeTotal: 12000,
        importeFinanciador: 9000,
        coseguro: 3000,
        vigenciaDesde: '2027-01-01',
        vigenciaHasta: '2027-12-31',
      },
      {
        codigoPractica: 'KIN-02',
        importeTotal: 8500.5,
        importeFinanciador: 8500.5,
        coseguro: 0,
        vigenciaDesde: '2027-01-01',
      },
    ]);
  });

  it('acepta coma como separador, alias cortos, ids, comillas, DD/MM/AAAA y lineas de comentario', () => {
    const texto = [
      '# nomenclador 2027',
      'practica,oferta,total,financiador,coseguro,desde,hasta',
      '',
      '55,31,"1000.10",900.10,100,1/2/2027,31/12/2027',
    ].join('\r\n');

    const { filas, errores, lineas } = parsearPlanilla(texto);

    expect(errores).toEqual([]);
    expect(lineas).toEqual([4]);
    expect(filas[0]).toEqual({
      practicaId: 55,
      ofertaId: 31,
      importeTotal: 1000.1,
      importeFinanciador: 900.1,
      coseguro: 100,
      vigenciaDesde: '2027-02-01',
      vigenciaHasta: '2027-12-31',
    });
  });

  it('cada error de formato sale con su linea y la fila no entra al lote', () => {
    const texto = [
      CABECERA,
      'KIN-01;1000.005;1000;0;2027-01-01;',
      ';1000;1000;0;2027-01-01;',
      'KIN-03;-5;0;0;2027-02-30;',
      'KIN-04;1.000,50;0;0;2027-01-01;',
      'KIN-05;100;100;0;2027-01-01;;extra',
      'KIN-06;100;100;0;2027-01-01;',
    ].join('\n');

    const { filas, errores } = parsearPlanilla(texto);

    expect(filas.map((fila) => fila.codigoPractica)).toEqual(['KIN-06']);
    expect(errores.map((error) => error.linea)).toEqual([2, 3, 4, 5, 6]);
    expect(errores[0].mensaje).toContain('mas de dos decimales');
    expect(errores[1].mensaje).toContain('Falta la practica');
    expect(errores[2].mensaje).toContain('no es un importe valido');
    expect(errores[2].mensaje).toContain('no es una fecha valida');
    expect(errores[3].mensaje).toContain('no es un importe valido');
    expect(errores[4].mensaje).toContain('7 columnas');
  });

  it('el encabezado se valida: columna desconocida, repetida, obligatoria o sin practica', () => {
    expect(parsearPlanilla('codigo;precio\nA;1').errores[0].mensaje).toContain('desconocida');
    expect(parsearPlanilla('codigo;codigoPractica\nA;B').errores[0].mensaje).toContain('repetida');
    expect(parsearPlanilla('codigo;total\nA;1').errores[0].mensaje).toContain('importeFinanciador');
    expect(
      parsearPlanilla('total;financiador;coseguro;desde\n1;1;0;2027-01-01').errores[0].mensaje,
    ).toContain('codigoPractica o practicaId');
  });

  it('vacia, solo encabezado o mas de 500 filas: error global y ninguna fila', () => {
    expect(parsearPlanilla('  \n').errores[0].linea).toBeNull();
    expect(parsearPlanilla(CABECERA).errores[0].mensaje).toContain('ninguna fila');

    const muchas = [
      CABECERA,
      ...Array.from({ length: MAXIMO_DE_FILAS + 1 }, (_, i) => `K${i};1;1;0;2027-01-01;`),
    ];
    const resultado = parsearPlanilla(muchas.join('\n'));
    expect(resultado.filas).toEqual([]);
    expect(resultado.errores[0].mensaje).toContain('501 filas');

    const justas = parsearPlanilla(muchas.slice(0, MAXIMO_DE_FILAS + 1).join('\n'));
    expect(justas.errores).toEqual([]);
    expect(justas.filas.length).toBe(MAXIMO_DE_FILAS);
  });
});

describe('motivoDeFilaRechazada', () => {
  it('distingue el choque contra un vigente del choque entre filas del lote', () => {
    const solapado = 'https://akine.app/problems/arancel-solapado';
    expect(motivoDeFilaRechazada({ problemType: solapado, arancelExistenteId: 900 })).toContain(
      'arancel #900',
    );
    expect(motivoDeFilaRechazada({ problemType: solapado, filaEnConflicto: 2 })).toContain(
      'fila 2 de esta misma planilla',
    );
  });

  it('traduce cada problemType y le suma el detalle del backend', () => {
    expect(motivoDeFilaRechazada({ problemType: 'not-found' })).toContain('no es accesible');
    expect(motivoDeFilaRechazada({ problemType: 'oferta-sin-obra-social' })).toContain(
      'no admite obra social',
    );
    expect(motivoDeFilaRechazada({ problemType: 'practica-no-habilitada-en-oferta' })).toContain(
      'no declara la practica',
    );
    expect(
      motivoDeFilaRechazada({ problemType: 'validation-error', detalle: 'La terna no cuadra.' }),
    ).toBe('Datos invalidos. La terna no cuadra.');
    expect(motivoDeFilaRechazada({})).toBe('El servidor rechazo la fila.');
  });
});
