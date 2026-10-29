import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Miga, MigasStore, publicarMigas } from './migas.store';

const nombre = signal('Pérez, Ana');

@Component({ template: '' })
class Pantalla {
  readonly migas = publicarMigas(() => [
    { etiqueta: 'Padrón', ruta: '/pacientes' },
    { etiqueta: nombre() },
  ]);
}

/** Lo que publica la pantalla abierta para la ruta de navegacion de la barra superior. */
describe('MigasStore', () => {
  let store: MigasStore;

  beforeEach(() => {
    nombre.set('Pérez, Ana');
    store = TestBed.inject(MigasStore);
  });

  it('una pantalla publica mientras vive, se actualiza sola y se retira al destruirse', () => {
    const fixture = TestBed.createComponent(Pantalla);
    fixture.detectChanges();
    expect(etiquetas(store.migas())).toEqual(['Padrón', 'Pérez, Ana']);

    nombre.set('Pérez, Ana María');
    TestBed.tick();
    expect(etiquetas(store.migas())).toEqual(['Padrón', 'Pérez, Ana María']);

    fixture.destroy();
    expect(store.migas()).toEqual([]);
  });

  it('la pantalla que se va no borra lo que ya publico la que llega', () => {
    const vieja = TestBed.createComponent(Pantalla);
    vieja.detectChanges();
    const nueva = {};
    store.publicar(nueva, [{ etiqueta: 'Egresos', ruta: '/egresos' }]);

    vieja.destroy();
    expect(etiquetas(store.migas())).toEqual(['Egresos']);
  });

  function etiquetas(migas: readonly Miga[]): string[] {
    return migas.map((miga) => miga.etiqueta);
  }
});
