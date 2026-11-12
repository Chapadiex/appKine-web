import { coordenadasFormateadas, enlaceComoLlegar, enlaceVerEnGoogleMaps } from './enlaces-de-mapa';

describe('enlaces de mapa', () => {
  it('arma el enlace para ver el punto en Google Maps', () => {
    expect(enlaceVerEnGoogleMaps(-34.5593, -58.4526)).toBe(
      'https://www.google.com/maps/search/?api=1&query=-34.5593,-58.4526',
    );
  });

  it('arma el enlace de "cómo llegar" con el punto como destino', () => {
    expect(enlaceComoLlegar(-34.5593, -58.4526)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=-34.5593,-58.4526',
    );
  });

  it('formatea las coordenadas con cuatro decimales y punto decimal', () => {
    expect(coordenadasFormateadas(-34.559312, -58.45)).toBe('-34.5593, -58.4500');
  });
});
