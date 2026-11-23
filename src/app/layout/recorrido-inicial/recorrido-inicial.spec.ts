import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PrimerosPasosStore } from '../../core/guards/primeros-pasos.guard';
import { RecorridoInicial } from './recorrido-inicial';

@Component({ template: '' })
class Vacia {}

const esperar = (ms = 0) => new Promise((resolver) => setTimeout(resolver, ms));

/** El menú y el contenido que el recorrido lee del documento: fuera del componente, como en la app. */
function armarDocumento(): void {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div id="fixture-recorrido">
      <app-navegacion-principal>
        <details class="nav__grupo"><summary><span class="nav__rotulo">Atención</span></summary>
          <a href="/agenda">Agenda</a>
        </details>
        <a class="nav__enlace--grupo" href="/inicio"><span class="nav__rotulo">Inicio</span></a>
      </app-navegacion-principal>
      <app-selector-de-sede></app-selector-de-sede>
      <app-menu-de-perfil></app-menu-de-perfil>
      <main id="contenido">
        <app-cabecera-de-pagina>Recepción</app-cabecera-de-pagina>
        <button type="button">Nuevo   turno</button>
      </main>
    </div>`,
  );
}

describe('RecorridoInicial', () => {
  let fixture: ComponentFixture<RecorridoInicial>;
  let pasos: PrimerosPasosStore;
  let anfitrion: HTMLElement;

  beforeEach(() => {
    armarDocumento();
    // jsdom no tiene scrollIntoView ni calcula layout.
    Element.prototype.scrollIntoView = vi.fn();
    //: todo elemento mide 100 × 40 en (10, 20).
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 20,
      left: 10,
      right: 110,
      bottom: 60,
      width: 100,
      height: 40,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });
    TestBed.configureTestingModule({
      imports: [RecorridoInicial],
      providers: [
        provideRouter([
          { path: 'agenda', component: Vacia },
          { path: 'agenda/recepcion', component: Vacia },
          { path: '**', component: Vacia },
        ]),
      ],
    });
    pasos = TestBed.inject(PrimerosPasosStore);
    fixture = TestBed.createComponent(RecorridoInicial);
    anfitrion = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    document.getElementById('fixture-recorrido')?.remove();
    vi.restoreAllMocks();
  });

  async function estabilizar(ms = 50): Promise<void> {
    fixture.detectChanges();
    await esperar(ms);
    fixture.detectChanges();
  }

  function boton(texto: string): HTMLButtonElement {
    const encontrado = [...anfitrion.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes(texto),
    );
    if (!encontrado) throw new Error(`Sin botón "${texto}"`);
    return encontrado;
  }

  it('la guía rápida lista sólo las guías cuya pantalla está en el menú', async () => {
    pasos.mostrarGuias();
    await estabilizar();

    const guias = [...anfitrion.querySelectorAll('.recorrido__guia b')].map((b) => b.textContent);
    expect(guias).toEqual(['Conocer el menú', 'Dar un turno']);
    expect(anfitrion.querySelector('.recorrido__velo')).not.toBeNull();
  });

  it('una guía por tarea lleva a su pantalla, marca el botón y avanza hasta el final', async () => {
    const router = TestBed.inject(Router);
    pasos.mostrarGuias();
    await estabilizar();
    boton('Dar un turno').click();
    await estabilizar(200);

    expect(router.url).toBe('/agenda');
    expect(anfitrion.querySelector('.recorrido__contador')?.textContent).toContain(
      'Dar un turno · Paso 1 de 3',
    );
    expect(anfitrion.querySelector('.recorrido__resaltado')).not.toBeNull();

    // Paso sin objetivo: tarjeta al centro, sobre el velo.
    boton('Siguiente').click();
    await estabilizar();
    expect(anfitrion.querySelector('.recorrido__resaltado')).toBeNull();
    expect(anfitrion.querySelector('.recorrido__velo')).not.toBeNull();

    boton('Anterior').click();
    await estabilizar(200);
    expect(anfitrion.querySelector('.recorrido__titulo')?.textContent).toContain(
      'Abrí el alta del turno',
    );

    boton('Siguiente').click();
    await estabilizar();
    boton('Siguiente').click();
    await estabilizar(200);
    expect(router.url).toBe('/agenda/recepcion');
    expect(boton('Listo')).toBeTruthy();

    boton('Listo').click();
    await estabilizar();
    expect(pasos.recorrido()).toBe(false);
    expect(pasos.guia()).toBeNull();
  });

  it('"Otras guías" vuelve a la lista desde un paso', async () => {
    pasos.mostrarGuias();
    await estabilizar();
    boton('Dar un turno').click();
    await estabilizar(200);

    boton('Otras guías').click();
    await estabilizar();
    expect(anfitrion.querySelector('.recorrido__selector')).not.toBeNull();
  });

  it('la guía del menú abre cada grupo, lo cierra al pasar y termina en la sede y el perfil', async () => {
    pasos.mostrarRecorridoDelMenu();
    await estabilizar(300);
    const grupo = document.querySelector<HTMLDetailsElement>('details.nav__grupo');

    expect(anfitrion.querySelector('.recorrido__titulo')?.textContent).toContain('Atención');
    expect(grupo?.open).toBe(true);

    boton('Siguiente').click();
    await estabilizar(300);
    expect(grupo?.open).toBe(false);
    expect(anfitrion.querySelector('.recorrido__texto')?.textContent).toContain(
      'Abrilo para ver las pantallas',
    );

    boton('Siguiente').click();
    await estabilizar(300);
    expect(anfitrion.querySelector('.recorrido__titulo')?.textContent).toContain(
      'Tu sede y tu perfil',
    );

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await estabilizar();
    expect(pasos.recorrido()).toBe(false);
  });

  it('el ✕ del selector cierra sin elegir', async () => {
    pasos.mostrarGuias();
    await estabilizar();
    boton('Cerrar').click();
    await estabilizar();
    expect(pasos.recorrido()).toBe(false);
  });
});
