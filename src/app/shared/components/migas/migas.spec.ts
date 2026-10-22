import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Miga, Migas } from './migas';

@Component({
  imports: [Migas],
  template: `<app-migas [migas]="migas()" [enLinea]="enLinea()" />`,
})
class Anfitrion {
  readonly migas = signal<readonly Miga[]>([
    { etiqueta: 'Ofertas de la sede', ruta: '/servicios/ofertas' },
    { etiqueta: 'Prácticas' },
  ]);

  readonly enLinea = signal(false);
}

describe('Migas', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('es un nav con nombre y una lista: los pasos con ruta son enlaces y el actual no', async () => {
    const fixture = TestBed.createComponent(Anfitrion);
    await fixture.whenStable();
    const nav: HTMLElement = fixture.nativeElement.querySelector('nav');

    expect(nav.getAttribute('aria-label')).toBe('Ruta de navegación');
    const items = nav.querySelectorAll('li');
    expect(items).toHaveLength(2);
    const enlace = items[0].querySelector('a');
    expect(enlace?.textContent?.trim()).toBe('Ofertas de la sede');
    expect(enlace?.getAttribute('href')).toBe('/servicios/ofertas');
    const actual = items[1].querySelector('[aria-current="page"]');
    expect(actual?.textContent?.trim()).toBe('Prácticas');
    expect(items[1].querySelector('a')).toBeNull();
  });

  it('en linea, marca la variante que termina con separador', async () => {
    const fixture = TestBed.createComponent(Anfitrion);
    fixture.componentInstance.enLinea.set(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('nav').classList).toContain('migas--en-linea');
  });
});
