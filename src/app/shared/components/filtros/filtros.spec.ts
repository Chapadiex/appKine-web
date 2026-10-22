import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Filtros } from './filtros';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../core/testing/axe';

@Component({
  imports: [Filtros],
  template: `
    <app-filtros [activos]="activos()" [soloAvanzados]="solo()">
      <div class="campo" filtro-principal>
        <label for="buscar">Buscar</label>
        <input id="buscar" type="search" />
      </div>
      <div class="campo">
        <label for="estado">Estado</label>
        <select id="estado">
          <option>Activos</option>
        </select>
      </div>
    </app-filtros>
  `,
})
class Anfitrion {
  readonly activos = signal(0);
  readonly solo = signal(false);
}

/**
 * Barra de filtros: el campo basico a la vista, los avanzados detras del embudo, el contador de
 * aplicados, y el panel que llega abierto si hay filtros activos y no se cierra solo.
 */
describe('Filtros', () => {
  let fixture: ComponentFixture<Anfitrion>;
  let html: HTMLElement;

  const boton = () => html.querySelector<HTMLButtonElement>('.filtros-barra__boton')!;
  const panel = () => html.querySelector<HTMLElement>('.filtros-barra__avanzados')!;

  beforeEach(() => {
    fixture = TestBed.createComponent(Anfitrion);
    fixture.detectChanges();
    html = fixture.nativeElement as HTMLElement;
  });

  it('muestra el campo basico y pliega los avanzados, que siguen en el DOM', () => {
    expect(html.querySelector('.filtros-barra__principal #buscar')).not.toBeNull();
    expect(panel().hidden).toBe(true);
    expect(panel().querySelector('#estado')).not.toBeNull();
    expect(boton().getAttribute('aria-expanded')).toBe('false');
    expect(boton().getAttribute('aria-controls')).toBe(panel().id);
    expect(boton().textContent).toContain('Filtros avanzados');
  });

  it('el embudo despliega y pliega los avanzados', () => {
    boton().click();
    fixture.detectChanges();
    expect(panel().hidden).toBe(false);
    expect(boton().getAttribute('aria-expanded')).toBe('true');

    boton().click();
    fixture.detectChanges();
    expect(panel().hidden).toBe(true);
  });

  it('cuenta los filtros aplicados, llega abierto si hay alguno y no se cierra solo', () => {
    fixture.componentInstance.activos.set(2);
    fixture.detectChanges();

    expect(html.querySelector('.filtros-barra__contador')?.textContent).toContain('2');
    expect(panel().hidden).toBe(false);

    fixture.componentInstance.activos.set(0);
    fixture.detectChanges();
    expect(html.querySelector('.filtros-barra__contador')).toBeNull();
    expect(panel().hidden).toBe(false);
  });

  it('sin campo basico, el boton lleva su texto a la vista', () => {
    fixture.componentInstance.solo.set(true);
    fixture.detectChanges();

    expect(boton().classList).toContain('filtros-barra__boton--con-texto');
    expect(boton().querySelector('.visualmente-oculto')).toBeNull();
    expect(boton().textContent).toContain('Filtros');
  });

  it(
    'no tiene violaciones de accesibilidad, desplegado',
    async () => {
      boton().click();
      fixture.detectChanges();

      await esperarSinViolaciones(html);
    },
    TIMEOUT_AXE,
  );
});
