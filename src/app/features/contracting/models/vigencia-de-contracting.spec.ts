import {
  enPalabras,
  hoyLocal,
  situacionDeVigencia,
  ventanaEnPalabras,
} from './vigencia-de-contracting';

const HOY = '2026-09-03';

/**
 * Spec de la clasificacion de vigencia de `contracting` (M15 y M16).
 *
 * <p>Los casos elegidos tienen todos la misma propiedad: <b>cuando estan mal, el sintoma no es un
 * error</b>. Nadie ve una excepcion; alguien mira una grilla, saca una conclusion equivocada sobre
 * si un convenio se aplica, y el bug aparece meses despues en una presentacion rechazada.
 *
 * <p>El mas caro de los cuatro es el fin <b>inclusivo</b>: el precedente del repositorio —la
 * oferta de `offering`— usa la convencion contraria, asi que copiar aquel archivo era el camino
 * natural y habria dado un convenio que "vence un dia antes" sin que ningun test lo notara.
 */
describe('situacionDeVigencia', () => {
  it('activo y vigente no se atenua ni necesita explicacion', () => {
    const situacion = situacionDeVigencia(
      { estado: 'ACTIVO', vigente: true, vigenciaDesde: '2026-01-01' },
      HOY,
      'convenio',
    );

    expect(situacion.clave).toBe('vigente');
    expect(situacion.atenuada).toBe(false);
    expect(situacion.explicacion).toBeNull();
  });

  it('EL FIN ES INCLUSIVO: el ultimo dia todavia se aplica, y el dia siguiente no', () => {
    // Es la diferencia con `offering`, donde el fin es EXCLUSIVO. Si esta rama se escribe con
    // `<=`, un convenio que termina hoy figura como terminado mientras el backend lo sigue
    // aplicando, y las dos mitades de la pantalla se contradicen.
    const ultimoDia = situacionDeVigencia(
      { estado: 'ACTIVO', vigente: true, vigenciaDesde: '2026-01-01', vigenciaHasta: HOY },
      HOY,
      'convenio',
    );
    expect(ultimoDia.clave).toBe('vigente');

    const yaVencido = situacionDeVigencia(
      {
        estado: 'ACTIVO',
        vigente: false,
        vigenciaDesde: '2026-01-01',
        vigenciaHasta: '2026-09-02',
      },
      HOY,
      'convenio',
    );
    expect(yaVencido.clave).toBe('ya-no');
    expect(yaVencido.explicacion).toContain('ese dia todavia se aplico');
    expect(yaVencido.explicacion).toContain('el fin es inclusivo');
  });

  it('activo pero todavia sin vigencia se distingue de activo y vigente', () => {
    // El caso que la pantalla existe para no aplanar: `estado` dice ACTIVO y `vigente` dice
    // false, y las dos cosas son correctas al mismo tiempo.
    const situacion = situacionDeVigencia(
      { estado: 'ACTIVO', vigente: false, vigenciaDesde: '2099-01-01' },
      HOY,
      'plan',
    );

    expect(situacion.clave).toBe('aun-no');
    expect(situacion.resumen).toContain('todavia sin vigencia');
    expect(situacion.explicacion).toContain('No es un error');
    expect(situacion.atenuada).toBe(true);
  });

  it('dada de baja no es lo mismo que vencida, y dice que no hay reactivacion', () => {
    // Cerrar la vigencia es el PUT y dar de baja es el DELETE. La fila tiene que decir cual de
    // las dos paso, porque la primera se deshace editando y la segunda no se deshace.
    const situacion = situacionDeVigencia(
      { estado: 'INACTIVO', vigente: false, vigenciaDesde: '2026-01-01' },
      HOY,
      'convenio',
    );

    expect(situacion.clave).toBe('dada-de-baja');
    expect(situacion.explicacion).toContain('no hay reactivacion');
    expect(situacion.explicacion).toContain('nunca reescribe historicos');
  });

  it('el sujeto cambia la consecuencia, porque "no se aplica" no le dice nada a nadie', () => {
    const sinVigencia = { estado: 'ACTIVO' as const, vigente: false, vigenciaDesde: '2099-01-01' };

    expect(situacionDeVigencia(sinVigencia, HOY, 'plan').explicacion).toContain(
      'no se ofrece para coberturas nuevas',
    );
    expect(situacionDeVigencia(sinVigencia, HOY, 'convenio').explicacion).toContain(
      'no resuelve ningun arancel',
    );
    expect(situacionDeVigencia(sinVigencia, HOY, 'arancel').explicacion).toContain(
      'no le pone precio a esa practica',
    );
  });

  it('sin poder precisar el extremo, dice algo que sigue siendo cierto', () => {
    // El backend calculo `vigente = false` y la pantalla no tiene con que explicar por cual de
    // los dos lados cae afuera. Inventar un motivo seria peor que no darlo.
    const situacion = situacionDeVigencia({ estado: 'ACTIVO', vigente: false }, HOY, 'arancel');
    expect(situacion.clave).toBe('fuera-de-ventana');
    expect(situacion.atenuada).toBe(true);
  });
});

describe('ventanaEnPalabras', () => {
  it('nombra el fin como inclusive y no promete eternidad cuando no hay fin', () => {
    expect(ventanaEnPalabras({ vigenciaDesde: '2026-01-01', vigenciaHasta: '2026-12-31' })).toBe(
      'Desde el 1 de enero de 2026 hasta el 31 de diciembre de 2026 inclusive',
    );
    // `null` significa "sin fin previsto", que admite que alguien lo cierre manana. "Para
    // siempre" seria una promesa que el contrato no hace.
    expect(ventanaEnPalabras({ vigenciaDesde: '2026-01-01' })).toContain('sin fin previsto');
    expect(ventanaEnPalabras({})).toContain('Sin inicio declarado');
  });
});

describe('enPalabras y hoyLocal', () => {
  it('no pierde un dia por pasar la fecha por Date, que interpreta UTC', () => {
    // `new Date('2026-05-25')` es medianoche UTC: en Argentina es el 24 a las 21. Es el bug que
    // `features/resource` ya documento para los feriados.
    expect(enPalabras('2026-05-25')).toBe('25 de mayo de 2026');
    expect(enPalabras('2026-01-01')).toBe('1 de enero de 2026');
  });

  it('devuelve el original si la fecha no tiene la forma esperada', () => {
    expect(enPalabras('manana')).toBe('manana');
    expect(enPalabras('2026-13-01')).toBe('2026-13-01');
    expect(enPalabras('2026-05-xx')).toBe('2026-05-xx');
  });

  it('hoy se calcula en hora local y no en UTC', () => {
    // Con una hora que en UTC ya es del dia siguiente, `hoyLocal` tiene que seguir diciendo hoy:
    // se usa como valor inicial del filtro de fecha, y arrancar con el dia equivocado haria que
    // la grilla mostrara vigencias de manana sin que nadie lo pidiera.
    expect(hoyLocal(new Date(2026, 8, 3, 23, 30))).toBe('2026-09-03');
    expect(hoyLocal(new Date(2026, 0, 9))).toBe('2026-01-09');
  });
});
