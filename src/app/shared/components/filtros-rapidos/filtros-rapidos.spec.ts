import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FiltroRapido, FiltrosRapidos } from './filtros-rapidos';

@Component({
  imports: [FiltrosRapidos],
  template: `
    <app-filtros-rapidos etiqueta="Filtrar por modalidad" [opciones]="opciones" [(valor)]="valor" />
  `,
})
class Anfitrion {
  readonly opciones: readonly FiltroRapido[] = [
    { valor: 'TODOS', etiqueta: 'Todos', cantidad: 3 },
    { valor: 'GRUPAL', etiqueta: 'Grupales', cantidad: 1 },
  ];

  readonly valor = signal('TODOS');
}

describe('FiltrosRapidos', () => {
  it('es un grupo con nombre, marca la opcion elegida y cambia el valor al hacer clic', async () => {
    const fixture = TestBed.createComponent(Anfitrion);
    await fixture.whenStable();
    const raiz: HTMLElement = fixture.nativeElement;

    expect(raiz.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Filtrar por modalidad',
    );
    const botones = raiz.querySelectorAll<HTMLButtonElement>('button');
    expect(botones[0].getAttribute('aria-pressed')).toBe('true');
    expect(botones[1].textContent).toContain('Grupales');
    expect(botones[1].textContent).toContain('1');

    botones[1].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.valor()).toBe('GRUPAL');
    expect(botones[1].getAttribute('aria-pressed')).toBe('true');
    expect(botones[0].getAttribute('aria-pressed')).toBe('false');
  });
});
