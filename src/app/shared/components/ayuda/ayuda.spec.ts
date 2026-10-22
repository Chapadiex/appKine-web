import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Ayuda } from './ayuda';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../core/testing/axe';

@Component({
  imports: [Ayuda],
  template: `
    <h1>Pantalla</h1>
    <app-ayuda titulo="Persona y paciente no son lo mismo">
      <p>Activar el perfil no crea historia clinica.</p>
    </app-ayuda>
    <p id="afuera">Contenido de la pantalla</p>
  `,
})
class Anfitrion {}

/**
 * Ayuda contextual: el boton abre y cierra el panel, Escape lo cierra y devuelve el foco, un clic
 * afuera lo cierra, y el contenido esta en el DOM aunque el panel este cerrado.
 */
describe('Ayuda', () => {
  let fixture: ComponentFixture<Anfitrion>;
  let html: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(Anfitrion);
    fixture.detectChanges();
    html = fixture.nativeElement as HTMLElement;
  });

  const boton = () => html.querySelector<HTMLButtonElement>('.ayuda-contextual__boton')!;
  const panel = () => html.querySelector<HTMLElement>('.ayuda-contextual__panel')!;

  it('arranca cerrada, con el contenido en el DOM y el botón nombrado por el titulo', () => {
    expect(boton().getAttribute('aria-expanded')).toBe('false');
    expect(boton().getAttribute('aria-controls')).toBe(panel().id);
    expect(boton().textContent).toContain('Ayuda: Persona y paciente no son lo mismo');
    expect(panel().hidden).toBe(true);
    expect(panel().textContent).toContain('no crea historia clínica');
  });

  it('el botón la abre y la cierra', () => {
    boton().click();
    fixture.detectChanges();
    expect(boton().getAttribute('aria-expanded')).toBe('true');
    expect(panel().hidden).toBe(false);

    boton().click();
    fixture.detectChanges();
    expect(panel().hidden).toBe(true);
  });

  it('Escape la cierra y devuelve el foco al botón', () => {
    boton().click();
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(boton());
  });

  it('un clic afuera la cierra; uno adentro del panel no', () => {
    boton().click();
    fixture.detectChanges();

    panel().click();
    fixture.detectChanges();
    expect(panel().hidden).toBe(false);

    html.querySelector<HTMLElement>('#afuera')!.click();
    fixture.detectChanges();
    expect(panel().hidden).toBe(true);
  });

  it(
    'no tiene violaciones de accesibilidad, abierta',
    async () => {
      boton().click();
      fixture.detectChanges();

      await esperarSinViolaciones(html);
    },
    TIMEOUT_AXE,
  );
});
