import {
  MODALIDADES_DE_CONVENIO,
  TIPOS_DE_FINANCIADOR,
  enUnaLinea,
  etiquetaDeModalidad,
  etiquetaDeTipo,
  explicarSinArancel,
  importeEnPalabras,
  importesCuadran,
  ternaEnPalabras,
} from './etiquetas-de-contracting';

/**
 * Spec de las etiquetas y los importes de `contracting` (M15 y M16).
 *
 * <p>Lo que se prueba aca no es que un `find` funcione: es que las <b>tres reglas economicas</b>
 * que la pantalla tiene que respetar no se puedan romper en silencio. Un importe sin moneda, una
 * terna que no cuadra por un centavo de coma flotante, y los dos motivos de "no hay arancel"
 * aplanados en uno solo son fallos que no producen ninguna excepcion.
 */
describe('etiquetas de los enumerados', () => {
  it('las tablas cubren los seis tipos y las cuatro modalidades del contrato', () => {
    // El `satisfies` del archivo ya lo garantiza en compilacion; esto fija el conteo para que
    // agregar un valor al contrato sin agregar su ayuda falle acá y no en pantalla.
    expect(TIPOS_DE_FINANCIADOR.length).toBe(6);
    expect(MODALIDADES_DE_CONVENIO.length).toBe(4);
    expect(TIPOS_DE_FINANCIADOR.every((opcion) => opcion.ayuda.length > 0)).toBe(true);
    expect(MODALIDADES_DE_CONVENIO.every((opcion) => opcion.ayuda.length > 0)).toBe(true);
  });

  it('un codigo desconocido se muestra crudo en vez de desaparecer', () => {
    // Si el backend agrega un valor antes que el frontend, la celda tiene que decir algo. Un
    // guion o un vacio dejaria la fila sin explicacion y parecerian datos corruptos.
    expect(etiquetaDeTipo('PREPAGA')).toBe('Prepaga');
    expect(etiquetaDeTipo('COOPERATIVA')).toBe('COOPERATIVA');
    expect(etiquetaDeTipo(undefined)).toBe('-');

    expect(etiquetaDeModalidad('CAPITA')).toBe('Capita');
    expect(etiquetaDeModalidad('POR_MODULO_NUEVO')).toBe('POR_MODULO_NUEVO');
  });

  it('el codigo acompana al nombre, salvo cuando seria repetirlo', () => {
    expect(enUnaLinea({ codigo: '410', nombre: 'OSDE' })).toBe('OSDE (410)');
    expect(enUnaLinea({ codigo: 'OSDE', nombre: 'OSDE' })).toBe('OSDE');
    expect(enUnaLinea({ nombre: 'OSDE' })).toBe('OSDE');
  });
});

describe('importes', () => {
  it('sin moneda no se muestra un numero pelado', () => {
    // Importe y moneda viajan juntos o no viajan: un importe sin moneda no es un importe, y este
    // SaaS va a operar en mas de un pais.
    expect(importeEnPalabras(1500, 'ARS')).toBe('ARS 1500.00');
    expect(importeEnPalabras(1500, undefined)).toBe('Sin declarar');
    expect(importeEnPalabras(1500, '')).toBe('Sin declarar');
  });

  it('copago nulo se lee "sin declarar" y NO como cero', () => {
    // El contrato es explicito: `null` significa "sin copago declarado", que no es lo mismo que
    // cero. Mostrar "ARS 0.00" le diria al mostrador que el paciente no paga nada.
    expect(importeEnPalabras(null, 'ARS')).toBe('Sin declarar');
    expect(importeEnPalabras(0, 'ARS')).toBe('ARS 0.00');
  });

  it('la terna se redacta como una suma y nombra a quien paga cada parte', () => {
    expect(
      ternaEnPalabras({ importeTotal: 12000, importeFinanciador: 9000, coseguro: 3000 }, 'ARS'),
    ).toBe('ARS 12000.00 = ARS 9000.00 (financiador) + ARS 3000.00 (paciente)');
  });

  it('la terna cuadra por centavos enteros, no por flotantes crudos', () => {
    // En JavaScript `1000.10 + 2000.20 !== 3000.30`. Comparando los flotantes, la pantalla
    // rechazaria un arancel que el backend —que usa BigDecimal— acepta sin chistar.
    expect(importesCuadran(3000.3, 1000.1, 2000.2)).toBe(true);
    expect(importesCuadran(12000, 9000, 3000)).toBe(true);
    // Un centavo de diferencia SI tiene que fallar: es la invariante economica, no un redondeo.
    expect(importesCuadran(12000, 9000, 3000.01)).toBe(false);
    expect(importesCuadran(Number.NaN, 9000, 3000)).toBe(false);
  });

  it('un coseguro de cero es valido: cobertura total no es dato faltante', () => {
    expect(importesCuadran(9000, 9000, 0)).toBe(true);
  });
});

describe('explicarSinArancel', () => {
  it('los dos motivos mandan a hacer cosas distintas', () => {
    // Aplanarlos deja al usuario sin saber si tiene que cobrar particular o cargar un precio.
    const sinConvenio = explicarSinArancel('SIN_CONVENIO_VIGENTE');
    expect(sinConvenio.queHacer).toContain('se cobra como particular');

    const sinArancel = explicarSinArancel('SIN_ARANCEL_VIGENTE');
    expect(sinArancel.titulo).toContain('Hay convenio');
    expect(sinArancel.queHacer).toContain('Carga el arancel');
  });

  it('un motivo desconocido o ausente cae en el mas seguro: cobrar particular', () => {
    // RN-M16-005: sin convenio valido no se asume cobertura. Ante la duda, la salida cerrada es
    // la que no le promete al paciente una cobertura que nadie verifico.
    expect(explicarSinArancel(undefined).queHacer).toContain('particular');
    expect(explicarSinArancel('ALGO_NUEVO').queHacer).toContain('particular');
  });
});
