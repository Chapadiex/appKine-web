import { esTerminal, fechaHoraEnZona, textoDeEstado, textoDeEvento } from './etiquetas-de-turno';

/**
 * Spec de los textos y las lecturas derivadas del turno (M12, AKINE-05.03).
 *
 * <p>Cubre <b>lo que decide comportamiento</b> y nada mas: que cancelado y ausente no se confundan, y
 * que un dato desconocido o sin zona no se muestre mal.
 */
describe('etiquetas de turno', () => {
  it('cancelado y ausente dicen cosas distintas: uno libera el lugar y el otro no', () => {
    expect(textoDeEstado('CANCELADO')).toContain('libero');
    expect(textoDeEstado('AUSENTE')).toContain('la hora se consumio igual');
    expect(esTerminal('CANCELADO')).toBe(true);
    expect(esTerminal('AUSENTE')).toBe(true);
    expect(esTerminal('RESERVADO')).toBe(false);
    expect(esTerminal('CONFIRMADO')).toBe(false);
  });

  it('un estado o un tipo que este cliente no conoce se muestra crudo, nunca en blanco', () => {
    // El contrato puede sumar uno sin romper nada. Una celda vacia se lee como "no tiene estado".
    //
    // Los valores de este test son inventados A PROPOSITO y hay que mantenerlos asi: usaba
    // 'LLEGADA', que en 0.23.0 paso a ser un tipo real y el test empezo a fallar por la razon
    // correcta —ya tiene rotulo—. Si un valor de aca se vuelve real, se cambia por otro que no
    // exista; no se borra la asercion.
    expect(textoDeEstado('EN_SALA_DE_YESO')).toBe('EN_SALA_DE_YESO');
    expect(textoDeEvento('TELETRANSPORTACION')).toBe('TELETRANSPORTACION');
    expect(textoDeEstado(undefined)).toBe('Estado desconocido');
  });

  it('formatea el instante en la zona de la sede y cae en UTC cuando no la sabe', () => {
    // 12:00Z son las 09:00 en Cordoba. Formatear con la zona del navegador correria el historial
    // entero sin que nada falle.
    expect(fechaHoraEnZona('2026-09-15T12:00:00Z', 'America/Argentina/Cordoba')).toContain('09:00');
    expect(fechaHoraEnZona('2026-09-15T12:00:00Z', '')).toContain('12:00');
    expect(fechaHoraEnZona('2026-09-15T12:00:00Z', 'Marte/Olympus')).toContain('12:00');
    expect(fechaHoraEnZona(undefined, 'UTC')).toBe('');
    expect(fechaHoraEnZona('no es una fecha', 'UTC')).toBe('');
  });
});
