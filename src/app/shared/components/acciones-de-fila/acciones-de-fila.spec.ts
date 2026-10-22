import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AccionesDeFila } from './acciones-de-fila';

@Component({
  imports: [AccionesDeFila],
  template: `
    <app-acciones-de-fila de="Kinesio adultos">
      <button principal type="button">Editar</button>
      <button type="button" (click)="bajas = bajas + 1">Dar de baja</button>
    </app-acciones-de-fila>
    <p id="afuera">afuera</p>
  `,
})
class Anfitrion {
  bajas = 0;
}

describe('AccionesDeFila', () => {
  async function montar() {
    const fixture = TestBed.createComponent(Anfitrion);
    await fixture.whenStable();
    const raiz: HTMLElement = fixture.nativeElement;
    const boton = raiz.querySelector<HTMLButtonElement>('.acciones-de-fila__boton')!;
    const panel = raiz.querySelector<HTMLElement>('.acciones-de-fila__panel')!;
    return { fixture, raiz, boton, panel };
  }

  it('deja la accion principal a la vista y esconde el resto detras del boton', async () => {
    const { raiz, boton, panel } = await montar();
    expect(raiz.querySelector('.acciones-de-fila > button[principal]')?.textContent).toBe('Editar');
    expect(boton.textContent).toContain('Más acciones de Kinesio adultos');
    expect(boton.getAttribute('aria-expanded')).toBe('false');
    expect(boton.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.hidden).toBe(true);
    expect(panel.textContent).toContain('Dar de baja');
  });

  it('abre al hacer clic y elegir una accion la ejecuta y cierra el menu', async () => {
    const { fixture, boton, panel } = await montar();
    boton.click();
    await fixture.whenStable();
    expect(boton.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);

    panel.querySelector('button')!.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.bajas).toBe(1);
    expect(panel.hidden).toBe(true);
  });

  it('Escape cierra y devuelve el foco al boton; un clic afuera cierra', async () => {
    const { fixture, raiz, boton, panel } = await montar();
    boton.click();
    await fixture.whenStable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(boton);

    boton.click();
    await fixture.whenStable();
    raiz.querySelector<HTMLElement>('#afuera')!.click();
    await fixture.whenStable();
    expect(panel.hidden).toBe(true);
  });
});
