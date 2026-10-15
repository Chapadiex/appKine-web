import {
  aCampoLocal,
  aInstanteUtc,
  formatearFecha,
  formatearHora,
  formatearInstante,
  mismoInstante,
} from './instantes';

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

  /**
   * 22:30 del 14/10 en Cordoba (UTC-3) son las 01:30 UTC del 15, y las 15:30 del 15 en Kiritimati
   * (UTC+14). Con la zona de la sede, el resultado no depende de la zona del navegador: se prueba
   * con las dos para que el spec diga lo mismo en el CI (UTC) que en una maquina de Cordoba.
   */
  describe('en la zona de la sede', () => {
    const CORDOBA = 'America/Argentina/Cordoba';
    const KIRITIMATI = 'Pacific/Kiritimati';
    const NOCHE_EN_CORDOBA = '2026-10-15T01:30:00Z';

    it('formatea el instante en el dia y la hora de la sede', () => {
      expect(formatearFecha(NOCHE_EN_CORDOBA, CORDOBA)).toBe('14/10/2026');
      expect(formatearFecha(NOCHE_EN_CORDOBA, KIRITIMATI)).toBe('15/10/2026');
      expect(formatearInstante(NOCHE_EN_CORDOBA, CORDOBA)).toContain('14/10/2026');
      expect(formatearInstante(NOCHE_EN_CORDOBA, CORDOBA)).toContain('22:30');
      expect(formatearHora(NOCHE_EN_CORDOBA, CORDOBA)).toBe('22:30');
      expect(formatearHora(undefined, CORDOBA)).toBeNull();
    });

    it('una fecha pura no se convierte, en ninguna zona', () => {
      expect(formatearFecha('2026-10-14', CORDOBA)).toBe('14/10/2026');
      expect(formatearFecha('2026-10-14', KIRITIMATI)).toBe('14/10/2026');
      expect(formatearFecha('', CORDOBA)).toBe('');
      expect(formatearFecha('no es fecha', CORDOBA)).toBe('');
    });

    it('el datetime-local se lee y se escribe en hora de la sede', () => {
      expect(aCampoLocal(NOCHE_EN_CORDOBA, CORDOBA)).toBe('2026-10-14T22:30');
      expect(aCampoLocal(NOCHE_EN_CORDOBA, KIRITIMATI)).toBe('2026-10-15T15:30');
      expect(aInstanteUtc('2026-10-14T22:30', CORDOBA)).toBe('2026-10-15T01:30:00.000Z');
      expect(aInstanteUtc('2026-10-15T15:30', KIRITIMATI)).toBe('2026-10-15T01:30:00.000Z');
    });

    it('respeta el cambio de horario de verano de la zona', () => {
      // Nueva York pasa de EST (UTC-5) a EDT (UTC-4) el 08/03/2026: el desfase cambia en el dia.
      expect(aInstanteUtc('2026-03-07T22:30', 'America/New_York')).toBe('2026-03-08T03:30:00.000Z');
      expect(aInstanteUtc('2026-03-08T22:30', 'America/New_York')).toBe('2026-03-09T02:30:00.000Z');
    });

    it('sin zona o con una desconocida cae a la del navegador, como antes', () => {
      expect(aCampoLocal(NOCHE_EN_CORDOBA, '')).toBe(aCampoLocal(NOCHE_EN_CORDOBA));
      expect(aCampoLocal(NOCHE_EN_CORDOBA, 'Marte/Olympus')).toBe(aCampoLocal(NOCHE_EN_CORDOBA));
      expect(aInstanteUtc('2026-10-14T22:30', 'Marte/Olympus')).toBe(
        aInstanteUtc('2026-10-14T22:30'),
      );
      expect(formatearInstante(NOCHE_EN_CORDOBA, null)).toBe(formatearInstante(NOCHE_EN_CORDOBA));
    });
  });
});
