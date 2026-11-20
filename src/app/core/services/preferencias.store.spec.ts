import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';

import { PreferenciasStore } from './preferencias.store';

describe('PreferenciasStore', () => {
  afterEach(() => {
    TestBed.inject(DOCUMENT).documentElement.removeAttribute('data-tema');
    TestBed.inject(DOCUMENT).defaultView?.localStorage.removeItem('akine.preferencias.tema');
  });

  it('sin una elección guardada arranca en claro', () => {
    TestBed.inject(DOCUMENT).defaultView?.localStorage.removeItem('akine.preferencias.tema');
    const store = TestBed.inject(PreferenciasStore);

    expect(store.tema()).toBe('claro');
    expect(TestBed.inject(DOCUMENT).documentElement.getAttribute('data-tema')).toBe('claro');
  });

  it('las pantallas de acceso fuerzan el claro y al salir vuelve el tema elegido', () => {
    const raiz = TestBed.inject(DOCUMENT).documentElement;
    const store = TestBed.inject(PreferenciasStore);
    store.elegirTema('oscuro');

    store.forzarClaro(true);
    expect(raiz.getAttribute('data-tema')).toBe('claro');
    // Elegir otro tema mientras esta forzado no rompe el claro de la pantalla de acceso.
    store.elegirTema('oscuro');
    expect(raiz.getAttribute('data-tema')).toBe('claro');

    store.forzarClaro(false);
    expect(raiz.getAttribute('data-tema')).toBe('oscuro');
    store.elegirTema('sistema');
    expect(raiz.hasAttribute('data-tema')).toBe(false);
  });
});
