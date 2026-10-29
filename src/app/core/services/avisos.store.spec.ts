import { TestBed } from '@angular/core/testing';

import { AvisosStore, DURACION_POR_DEFECTO, MAXIMO_DE_AVISOS } from './avisos.store';

/**
 * Avisos globales: cada tipo dura lo suyo, un error con accion no se va solo, no conviven mas de
 * tres, y el puntero encima pausa el cierre.
 */
describe('AvisosStore', () => {
  let store: AvisosStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = TestBed.inject(AvisosStore);
  });

  afterEach(() => vi.useRealTimers());

  it('un exito se cierra solo a su tiempo', () => {
    store.exito('Persona registrada correctamente');
    expect(store.avisos().map((aviso) => aviso.titulo)).toEqual([
      'Persona registrada correctamente',
    ]);

    vi.advanceTimersByTime(DURACION_POR_DEFECTO.exito - 1);
    expect(store.avisos()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.avisos()).toHaveLength(0);
  });

  it('un error con accion queda hasta que el usuario lo cierra o la usa', () => {
    const reintentar = vi.fn();
    const id = store.error('No pudimos guardar los cambios', {
      accion: { etiqueta: 'Reintentar', ejecutar: reintentar },
    });

    vi.advanceTimersByTime(60_000);
    expect(store.avisos()).toHaveLength(1);

    store.ejecutar(id);
    expect(reintentar).toHaveBeenCalledTimes(1);
    expect(store.avisos()).toHaveLength(0);
  });

  it(`no conviven mas de ${MAXIMO_DE_AVISOS}: se va el mas viejo`, () => {
    ['Uno', 'Dos', 'Tres', 'Cuatro'].forEach((titulo) => store.info(titulo));

    expect(store.avisos().map((aviso) => aviso.titulo)).toEqual(['Dos', 'Tres', 'Cuatro']);
  });

  it('pausar detiene el cierre y reanudar vuelve a contar desde el principio', () => {
    const id = store.exito('Cambios guardados');
    vi.advanceTimersByTime(4000);
    store.pausar(id);
    vi.advanceTimersByTime(60_000);
    expect(store.avisos()).toHaveLength(1);

    store.reanudar(id);
    vi.advanceTimersByTime(DURACION_POR_DEFECTO.exito);
    expect(store.avisos()).toHaveLength(0);
  });

  it('una advertencia puede pedir quedarse hasta que la cierren', () => {
    const id = store.advertencia('Hay horarios sin profesionales asignados', { duracion: null });
    vi.advanceTimersByTime(60_000);
    expect(store.avisos()).toHaveLength(1);

    store.cerrar(id);
    expect(store.avisos()).toHaveLength(0);
  });

  it('vaciar saca todos', () => {
    store.exito('Uno');
    store.error('Dos', { accion: { etiqueta: 'Reintentar', ejecutar: () => undefined } });
    store.vaciar();
    expect(store.avisos()).toHaveLength(0);
  });
});
