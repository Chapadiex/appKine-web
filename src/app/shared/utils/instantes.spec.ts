import { aCampoLocal, aInstanteUtc, formatearInstante, mismoInstante } from './instantes';

/**
 * Spec de la conversion entre el instante UTC del contrato y el control del navegador.
 *
 * <p>Cubre el bug que esta funcion existe para evitar y que <b>no falla en CI</b>: un servidor
 * de integracion corriendo en UTC ve pasar cualquier implementacion, incluida la ingenua
 * `toISOString().slice(0, 16)`, y el desfasaje de tres horas aparece recien en produccion.
 * Por eso el ida y vuelta se verifica contra la zona real del entorno, sea cual sea.
 */
describe('instantes', () => {
  it('el ida y vuelta conserva el instante, aunque la zona local no sea UTC', () => {
    const original = '2026-09-01T13:30:00Z';

    const campo = aCampoLocal(original);
    // El valor del control es hora LOCAL sin zona: nunca lleva la Z ni el offset.
    expect(campo).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(campo).not.toContain('Z');

    // Y vuelve al mismo momento, que es lo unico que importa.
    expect(new Date(aInstanteUtc(campo) ?? '').getTime()).toBe(new Date(original).getTime());
  });

  it('lo ausente y lo invalido degradan a vacio en vez de viajar como "Invalid Date"', () => {
    // Un valor invalido tiene que OMITIRSE del cuerpo. Si viajara, el backend responderia un
    // 400 que no dice cual de los campos de fecha estaba mal.
    expect(aInstanteUtc('')).toBeNull();
    expect(aInstanteUtc('no es una fecha')).toBeNull();

    expect(aCampoLocal(undefined)).toBe('');
    expect(aCampoLocal(null)).toBe('');
    expect(aCampoLocal('')).toBe('');
    expect(aCampoLocal('no es una fecha')).toBe('');

    expect(formatearInstante(undefined)).toBeNull();
    expect(formatearInstante('')).toBeNull();
    expect(formatearInstante('no es una fecha')).toBeNull();
    expect(formatearInstante('2026-09-01T13:30:00Z')).toBeTruthy();
  });

  it('mismoInstante compara momentos y no texto', () => {
    // El caso que rompe el PATCH: el mismo momento escrito de dos formas. Comparado como texto,
    // el campo pareceria haber cambiado y se reenviaria en cada guardado.
    expect(mismoInstante('2026-09-01T00:00:00Z', '2026-09-01T00:00:00.000Z')).toBe(true);
    expect(mismoInstante('2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z')).toBe(false);

    // Ausente es igual a ausente, y distinto de cualquier instante.
    expect(mismoInstante(undefined, null)).toBe(true);
    expect(mismoInstante(undefined, '2026-09-01T00:00:00Z')).toBe(false);
  });
});
