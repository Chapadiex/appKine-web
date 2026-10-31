import { Route } from '@angular/router';

import { routes } from './scheduling.routes';

/**
 * Las direcciones viejas de la agenda: hay enlaces guardados. El calendario semanal pasó a ser la vista
 * Semana de la agenda y tiene que abrir esa misma semana.
 */
describe('rutas de la agenda', () => {
  const ruta = (path: string): Route => {
    const encontrada = routes.find((candidata) => candidata.path === path);
    if (encontrada === undefined) {
      throw new Error(`No existe la ruta ${path}`);
    }
    return encontrada;
  };

  it('el calendario redirige a la vista Semana, con la semana del enlace', () => {
    const redirigir = ruta('calendario').redirectTo as (entrada: {
      queryParams: Record<string, string>;
    }) => string;

    expect(redirigir({ queryParams: { semana: '2030-03-04' } })).toBe(
      '/agenda?vista=semana&fecha=2030-03-04',
    );
    expect(redirigir({ queryParams: {} })).toBe('/agenda?vista=semana');
  });

  it('reservar ya no es una pantalla: los enlaces viejos van a buscar disponibilidad', () => {
    expect(ruta('ofertas/:ofertaId/reservar').redirectTo).toBe('disponibilidad');
    expect(ruta('ofertas/:ofertaId/reservar-serie').redirectTo).toBe('disponibilidad');
  });
});
