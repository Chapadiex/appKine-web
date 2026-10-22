import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ColumnaOrdenable } from './columna-ordenable';
import { tablaLocal } from './tabla-local';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../core/testing/axe';

interface Fila {
  readonly id: number;
  readonly nombre: string;
  readonly alta: string | null;
}

const FILAS: readonly Fila[] = [
  { id: 1, nombre: 'Osde', alta: '2026-03-01' },
  { id: 2, nombre: 'apross', alta: null },
  { id: 3, nombre: 'Galeno', alta: '2025-11-15' },
];

@Component({
  imports: [ColumnaOrdenable],
  template: `
    <table>
      <thead>
        <tr>
          <th scope="col" appOrdenable [tabla]="tabla" columna="nombre">Nombre</th>
          <th scope="col">Id</th>
        </tr>
      </thead>
      <tbody>
        @for (fila of tabla.visibles(); track fila.id) {
          <tr>
            <td>{{ fila.nombre }}</td>
            <td>{{ fila.id }}</td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
class Anfitrion {
  readonly filas = signal<readonly Fila[]>(FILAS);
  readonly tabla = tablaLocal(this.filas, { columnas: { nombre: (f) => f.nombre } });
}

/**
 * Tabla de lista completa: ordena sin distinguir mayusculas y con los vacios al final, cicla
 * asc → desc → original, pagina, y vuelve a la primera pagina cuando cambian las filas.
 */
describe('tablaLocal', () => {
  it('ordena asc, desc y vuelve al orden del servidor; los vacios van al final', () => {
    TestBed.runInInjectionContext(() => {
      const filas = signal(FILAS);
      const tabla = tablaLocal(filas, {
        columnas: { nombre: (f) => f.nombre, alta: (f) => f.alta },
      });

      tabla.ordenarPor('nombre');
      expect(tabla.visibles().map((f) => f.nombre)).toEqual(['apross', 'Galeno', 'Osde']);

      tabla.ordenarPor('nombre');
      expect(tabla.visibles().map((f) => f.nombre)).toEqual(['Osde', 'Galeno', 'apross']);

      tabla.ordenarPor('nombre');
      expect(tabla.visibles().map((f) => f.id)).toEqual([1, 2, 3]);

      tabla.ordenarPor('alta');
      expect(tabla.visibles().map((f) => f.id)).toEqual([3, 1, 2]);
    });
  });

  it('pagina, y vuelve a la primera pagina cuando cambian las filas', () => {
    TestBed.runInInjectionContext(() => {
      const muchas = Array.from({ length: 45 }, (_, i) => ({ id: i, nombre: `F${i}`, alta: null }));
      const filas = signal<readonly Fila[]>(muchas);
      const tabla = tablaLocal(filas, { columnas: {}, porPagina: 20 });

      expect(tabla.totalPaginas()).toBe(3);
      expect(tabla.total()).toBe(45);
      tabla.irA(2);
      expect(tabla.visibles().map((f) => f.id)).toEqual([40, 41, 42, 43, 44]);

      tabla.irA(9);
      expect(tabla.pagina()).toBe(2);

      filas.set(muchas.slice(0, 5));
      expect(tabla.pagina()).toBe(0);
      expect(tabla.totalPaginas()).toBe(1);
    });
  });

  describe('columna ordenable', () => {
    let fixture: ComponentFixture<Anfitrion>;
    let html: HTMLElement;

    beforeEach(() => {
      fixture = TestBed.createComponent(Anfitrion);
      fixture.detectChanges();
      html = fixture.nativeElement as HTMLElement;
    });

    const th = () => html.querySelector<HTMLElement>('th[appOrdenable]')!;
    const celdas = () =>
      Array.from(html.querySelectorAll('tbody td:first-child')).map((c) => c.textContent?.trim());

    it('el boton del encabezado ordena y aria-sort lo dice, solo en la columna ordenada', () => {
      expect(th().getAttribute('aria-sort')).toBeNull();

      th().querySelector('button')!.click();
      fixture.detectChanges();
      expect(th().getAttribute('aria-sort')).toBe('ascending');
      expect(celdas()).toEqual(['apross', 'Galeno', 'Osde']);

      th().querySelector('button')!.click();
      fixture.detectChanges();
      expect(th().getAttribute('aria-sort')).toBe('descending');
    });

    it(
      'no tiene violaciones de accesibilidad',
      async () => {
        await esperarSinViolaciones(html);
      },
      TIMEOUT_AXE,
    );
  });
});
