import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { Pestanas } from './pestanas';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../core/testing/axe';

@Component({ template: 'pagina' })
class Pagina {}

/**
 * Pestanas de seccion. El router es real: `aria-current` sale de `routerLinkActive`, y la
 * pestana raiz (`exacta`) no puede quedar marcada en sus hermanas.
 */
describe('Pestanas', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'agenda', component: Pagina },
          { path: 'agenda/recepcion', component: Pagina },
        ]),
      ],
    });
    router = TestBed.inject(Router);
  });

  it('marca la pestana actual con aria-current, y la raiz solo cuando la URL es exacta', async () => {
    const fixture = montar([
      { etiqueta: 'Turnos', ruta: '/agenda', exacta: true },
      { etiqueta: 'Recepcion', ruta: '/agenda/recepcion' },
    ]);

    await router.navigateByUrl('/agenda/recepcion');
    fixture.detectChanges();
    expect(marcadas(fixture)).toEqual(['Recepcion']);

    await router.navigateByUrl('/agenda');
    fixture.detectChanges();
    expect(marcadas(fixture)).toEqual(['Turnos']);
  });

  it('con una sola pestana no dibuja nada: no hay entre que elegir', () => {
    const fixture = montar([{ etiqueta: 'Turnos', ruta: '/agenda', exacta: true }]);

    expect((fixture.nativeElement as HTMLElement).querySelector('nav')).toBeNull();
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = montar([
        { etiqueta: 'Turnos', ruta: '/agenda', exacta: true },
        { etiqueta: 'Recepcion', ruta: '/agenda/recepcion' },
      ]);

      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  function montar(pestanas: Pestanas['pestanas'] extends () => infer T ? T : never) {
    const fixture: ComponentFixture<Pestanas> = TestBed.createComponent(Pestanas);
    fixture.componentRef.setInput('pestanas', pestanas);
    fixture.componentRef.setInput('etiqueta', 'Pantallas de prueba');
    fixture.detectChanges();
    return fixture;
  }

  function marcadas(fixture: ComponentFixture<Pestanas>): (string | undefined)[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>(
        'a[aria-current="page"]',
      ),
    ).map((enlace) => enlace.textContent?.trim());
  }
});
