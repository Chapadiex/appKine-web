import { etiquetaDeZona, zonasHorarias } from './zonas-horarias';

/**
 * Spec del catalogo de zonas horarias (M01, AKINE-02.01).
 *
 * <p>Lo que importa verificar es que <b>siempre haya algo que elegir</b>: el `select` es lo
 * unico que impide mandar un offset fijo como `-03:00`, que el backend rechaza con `400`
 * porque no conoce el horario de verano. Si la lista quedara vacia en algun motor, el alta de
 * sede seria imposible en ese navegador y el sintoma seria un desplegable sin opciones, sin
 * ningun error que lo explique.
 */
describe('zonasHorarias', () => {
  it('ofrece las zonas argentinas primero y separadas del resto', () => {
    const zonas = zonasHorarias();

    expect(zonas.argentinas).toContain('America/Argentina/Cordoba');
    expect(zonas.argentinas).toContain('America/Argentina/Buenos_Aires');
    expect(zonas.argentinas.every((zona) => zona.startsWith('America/Argentina/'))).toBe(true);

    // Ni la forma larga ni el alias viejo aparecen en el grupo mundial. `supportedValuesOf`
    // canonicaliza segun la version de ICU -en Node 24 devuelve `America/Cordoba`- y sin
    // descartarlo habria dos opciones para la misma ciudad, guardadas con identificadores
    // distintos en dos sedes del mismo centro.
    expect(zonas.resto).not.toContain('America/Argentina/Cordoba');
    expect(zonas.resto).not.toContain('America/Cordoba');
    expect(zonas.resto).not.toContain('America/Buenos_Aires');
  });

  it('la etiqueta es la ciudad legible, aunque el valor siga siendo el identificador IANA', () => {
    // El `value` del `option` es la zona completa: lo que viaja al backend nunca es esto.
    expect(etiquetaDeZona('America/Argentina/Rio_Gallegos')).toBe('Rio Gallegos');
    expect(etiquetaDeZona('UTC')).toBe('UTC');
  });
});
