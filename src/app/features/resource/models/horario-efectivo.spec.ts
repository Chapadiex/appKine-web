import { FranjaResueltaResponseOrigenEnum } from '../../../api/generated/model/franja-resuelta-response';
import {
  RAZON_VACIO_CIERRE,
  RAZON_VACIO_FERIADO,
  RAZON_VACIO_VINCULO,
  RECORTE_POR_CIERRE,
  etiquetaDeOrigen,
  explicacionDeVacio,
  rangoDeFranja,
  textoDeRecorte,
} from './horario-efectivo';

const ZONA = 'America/Argentina/Buenos_Aires';

/**
 * Spec del vocabulario de la disponibilidad efectiva (M05, AKINE-02.04).
 *
 * <p>Estos cuatro literales <b>no los chequea el compilador</b>: el contrato les saco el `enum`
 * a proposito y el cliente los tipa `string | null`. Un `FERIADO` mal escrito compila, pasa el
 * lint y produce el cartel equivocado. Este spec es lo unico que lo atrapa.
 */
describe('explicacionDeVacio', () => {
  it('el feriado se nombra: un dia que solo dice "cerrado" manda a buscar un cierre que no existe', () => {
    const explicacion = explicacionDeVacio(
      { fecha: '2026-12-25', razonVacio: RAZON_VACIO_FERIADO, feriadoNombre: 'Navidad' },
      'Ana Diaz',
    );

    expect(explicacion.titulo).toContain('Navidad');
    expect(explicacion.detalle).toContain('cierra los feriados');
    expect(explicacion.enlace.ruta).toBe('/horarios/calendario');
  });

  it('un feriado sin nombre se degrada, pero no queda en "cerrado" a secas', () => {
    const explicacion = explicacionDeVacio(
      { fecha: '2026-12-25', razonVacio: RAZON_VACIO_FERIADO },
      'Ana Diaz',
    );

    expect(explicacion.titulo).toContain('feriado del calendario nacional');
  });

  it('el cierre nombra la excepcion concreta cuando el backend publica su id', () => {
    const explicacion = explicacionDeVacio(
      { fecha: '2026-09-02', razonVacio: RAZON_VACIO_CIERRE, reglaVacio: 77 },
      'Ana Diaz',
    );

    expect(explicacion.titulo).toContain('cierre cargado');
    expect(explicacion.detalle).toContain('numero 77');
    expect(explicacion.enlace.ruta).toBe('/horarios/excepciones');
  });

  /**
   * El salto tiene que llegar filtrado por lo que la explicacion nombra.
   *
   * <p>La pantalla de excepciones abre en "solo las de toda la sede" sobre noventa dias desde
   * hoy. Un enlace sin params desde "la excepcion de cierre numero 77 cubre el dia entero"
   * aterriza en una lista donde ese cierre —si es de Ana, que es el caso corriente de una
   * ausencia— no aparece, y nada indica que un filtro lo esta tapando.
   */
  it('el enlace del cierre lleva al profesional y al dia del que hablaba la explicacion', () => {
    const explicacion = explicacionDeVacio(
      { fecha: '2026-09-02', razonVacio: RAZON_VACIO_CIERRE, reglaVacio: 77 },
      'Ana Diaz',
      42,
    );

    expect(explicacion.enlace.params).toEqual({
      membershipId: '42',
      desde: '2026-09-02',
      // El fin es exclusivo en las cuatro pantallas: un solo dia es [D, D+1).
      hasta: '2026-09-03',
    });
  });

  it('sin profesional elegido el enlace lleva solo el dia, y nunca un id inventado', () => {
    const explicacion = explicacionDeVacio(
      { fecha: '2026-09-02', razonVacio: RAZON_VACIO_CIERRE, reglaVacio: 77 },
      'Ana Diaz',
    );

    expect(explicacion.enlace.params).toEqual({ desde: '2026-09-02', hasta: '2026-09-03' });
  });

  it('el feriado tambien viaja con su dia: la ventana por defecto del calendario es un año', () => {
    const explicacion = explicacionDeVacio(
      { fecha: '2026-12-25', razonVacio: RAZON_VACIO_FERIADO, feriadoNombre: 'Navidad' },
      'Ana Diaz',
      42,
    );

    // Sin `membershipId`: la politica de feriados es de la sede y no se filtra por persona.
    expect(explicacion.enlace.params).toEqual({ desde: '2026-12-25', hasta: '2026-12-26' });
  });

  it('el dia sin ninguna regla manda al horario semanal ya abierto en esa persona', () => {
    const explicacion = explicacionDeVacio({ fecha: '2026-09-05', razonVacio: null }, 'Ana', 42);

    expect(explicacion.enlace.ruta).toBe('/horarios');
    expect(explicacion.enlace.params).toEqual({ membershipId: '42' });
  });

  it('un dia sin fecha no inventa ventana: el destino abre con la suya', () => {
    const explicacion = explicacionDeVacio({ razonVacio: RAZON_VACIO_CIERRE }, 'Ana', 42);

    expect(explicacion.enlace.params).toEqual({ membershipId: '42' });
  });

  it('un cierre sin id explica igual y no inventa un numero', () => {
    const explicacion = explicacionDeVacio(
      { fecha: '2026-09-02', razonVacio: RAZON_VACIO_CIERRE },
      'Ana Diaz',
    );

    expect(explicacion.detalle).toContain('Una excepcion de cierre cubre el dia entero');
    expect(explicacion.detalle).not.toContain('numero');
  });

  it('VINCULO habla de la persona y se distingue de "no atiende ese dia"', () => {
    const explicacion = explicacionDeVacio(
      { fecha: '2026-09-03', razonVacio: RAZON_VACIO_VINCULO },
      'Ana Diaz',
    );

    expect(explicacion.titulo).toContain('Ana Diaz');
    expect(explicacion.titulo).toContain('no estaba vinculado');
    expect(explicacion.detalle).toContain('todavia no se habia incorporado');
    expect(explicacion.detalle).toContain('desvinculado');
    // La confusion que este texto existe para evitar.
    expect(explicacion.titulo).not.toContain('No trabaja ese dia');
    expect(explicacion.enlace.ruta).toBe('/organizacion/colaboradores');
  });

  it('sin razon es la AUSENCIA de reglas, y no ofrece ningun cierre para ir a mirar', () => {
    const explicacion = explicacionDeVacio({ fecha: '2026-09-05', razonVacio: null }, 'Ana Diaz');

    expect(explicacion.titulo).toBe('No trabaja ese dia.');
    expect(explicacion.detalle).toContain('Ninguna regla abre ese dia');
    expect(explicacion.detalle).toContain('No hay ningun cierre ni feriado');
    expect(explicacion.enlace.ruta).toBe('/horarios');
  });

  it('una razon desconocida cae en el texto de "ninguna regla" y no rompe la pantalla', () => {
    // El contrato puede sumar un motivo nuevo sin que este cliente se entere: el tipo generado
    // es `string | null` y no hay enum que lo frene.
    const explicacion = explicacionDeVacio(
      { fecha: '2026-09-05', razonVacio: 'MOTIVO_QUE_NO_EXISTE_TODAVIA' },
      'Ana Diaz',
    );

    expect(explicacion.titulo).toBe('No trabaja ese dia.');
  });
});

describe('etiquetaDeOrigen y textoDeRecorte', () => {
  it('distingue el horario semanal de una apertura puntual, con el id de la fila', () => {
    expect(
      etiquetaDeOrigen({ origen: FranjaResueltaResponseOrigenEnum.BLOQUE, reglaId: 5 }),
    ).toContain('horario semanal, bloque numero 5');

    expect(
      etiquetaDeOrigen({ origen: FranjaResueltaResponseOrigenEnum.APERTURA, reglaId: 9 }),
    ).toContain('apertura puntual numero 9');
  });

  it('sin id de regla no inventa un numero', () => {
    expect(etiquetaDeOrigen({ origen: FranjaResueltaResponseOrigenEnum.BLOQUE })).toBe(
      'La produjo el horario semanal, bloque.',
    );
  });

  it('el recorte se nombra solo cuando lo hubo', () => {
    expect(textoDeRecorte({ recortadoPor: RECORTE_POR_CIERRE })).toContain(
      'Recortada por un cierre',
    );
    expect(textoDeRecorte({ recortadoPor: null })).toBeNull();
    expect(textoDeRecorte({})).toBeNull();
  });
});

describe('rangoDeFranja', () => {
  it('convierte los instantes UTC a la hora de pared de la sede, no a la del navegador', () => {
    // 12:00Z en Buenos Aires son las 09:00. Formatear con la zona local del que mira mostraria
    // el horario de la sede corrido.
    const rango = rangoDeFranja(
      { desde: '2026-09-01T12:00:00Z', hasta: '2026-09-01T16:00:00Z' },
      '2026-09-01',
      ZONA,
    );

    expect(rango).toBe('09:00 a 13:00');
  });

  it('una franja que llega al fin del dia se escribe 24:00 y no 00:00', () => {
    // El contrato manda el INICIO DEL DIA SIGUIENTE. Mostrado tal cual diria "20:00 a 00:00",
    // que se lee como una franja invertida.
    const rango = rangoDeFranja(
      { desde: '2026-09-01T23:00:00Z', hasta: '2026-09-02T03:00:00Z' },
      '2026-09-01',
      ZONA,
    );

    expect(rango).toBe('20:00 a 24:00');
  });

  it('la medianoche del propio dia sigue siendo 00:00', () => {
    const rango = rangoDeFranja(
      { desde: '2026-09-01T03:00:00Z', hasta: '2026-09-01T15:00:00Z' },
      '2026-09-01',
      ZONA,
    );

    expect(rango).toBe('00:00 a 12:00');
  });

  it('una zona que el navegador no conoce no tira abajo la pantalla', () => {
    const rango = rangoDeFranja(
      { desde: '2026-09-01T12:00:00Z', hasta: '2026-09-01T16:00:00Z' },
      '2026-09-01',
      'Marte/Olympus_Mons',
    );

    expect(rango).toMatch(/^\d{2}:\d{2} a \d{2}:\d{2}$/);
  });

  it('sin zona declarada formatea igual, en la del navegador', () => {
    expect(
      rangoDeFranja(
        { desde: '2026-09-01T12:00:00Z', hasta: '2026-09-01T16:00:00Z' },
        '2026-09-01',
        undefined,
      ),
    ).toMatch(/^\d{2}:\d{2} a \d{2}:\d{2}$/);
  });

  it('una franja sin instantes o con un instante ilegible no imprime nada', () => {
    expect(rangoDeFranja({}, '2026-09-01', ZONA)).toBe('');
    expect(
      rangoDeFranja(
        { desde: 'no-es-una-fecha', hasta: '2026-09-01T16:00:00Z' },
        '2026-09-01',
        ZONA,
      ),
    ).toBe('');
    expect(rangoDeFranja({ desde: '2026-09-01T12:00:00Z' }, '2026-09-01', ZONA)).toBe('');
  });

  it('sin fecha del dia no se puede decidir el 24:00 y se imprime la hora tal cual', () => {
    expect(
      rangoDeFranja(
        { desde: '2026-09-01T23:00:00Z', hasta: '2026-09-02T03:00:00Z' },
        undefined,
        ZONA,
      ),
    ).toBe('20:00 a 00:00');
  });
});
