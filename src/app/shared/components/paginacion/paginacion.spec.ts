import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Paginacion } from './paginacion';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../core/testing/axe';

@Component({
  imports: [Paginacion],
  template: `
    <app-paginacion
      etiqueta="Páginas de sedes"
      [paginaActual]="pagina()"
      [totalPaginas]="paginas()"
      [total]="total()"
      [porPagina]="porPagina()"
      (cambioDePagina)="pedidas.push($event)"
      (cambioDePorPagina)="tamanos.push($event)"
    />
  `,
})
class Anfitrion {
  readonly pagina = signal(0);
  readonly paginas = signal(9);
  readonly total = signal<number | null>(87);
  readonly porPagina = signal<number | null>(10);
  readonly pedidas: number[] = [];
  readonly tamanos: number[] = [];
}

/** Pie estandar de tabla: resumen, filas por pagina y paginas con saltos, en una fila. */
describe('Paginacion', () => {
  let fixture: ComponentFixture<Anfitrion>;
  let html: HTMLElement;

  const pasos = () =>
    Array.from(html.querySelectorAll('.paginacion > *')).map((e) =>
      e.textContent?.replace(/\s+/g, ' ').trim(),
    );

  beforeEach(() => {
    fixture = TestBed.createComponent(Anfitrion);
    fixture.detectChanges();
    html = fixture.nativeElement as HTMLElement;
  });

  it('dice que filas se ven, ofrece 10/25/50/100 y numera las paginas con saltos', () => {
    expect(html.querySelector('.paginacion-pie__resumen')?.textContent).toBe(
      'Mostrando 1–10 de 87',
    );
    const opciones = Array.from(html.querySelectorAll('select option')).map((o) => o.textContent);
    expect(opciones).toEqual(['10', '25', '50', '100']);
    expect(pasos()).toEqual([
      '‹Página anterior',
      'Página 1',
      'Página 2',
      'Página 3',
      'Página 4',
      '…',
      'Página 9',
      '›Página siguiente',
    ]);
    expect(html.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('Página 1');
  });

  it('en el medio muestra la actual con sus vecinas', () => {
    fixture.componentInstance.pagina.set(4);
    fixture.detectChanges();
    expect(html.querySelector('.paginacion-pie__resumen')?.textContent).toBe(
      'Mostrando 41–50 de 87',
    );
    expect(pasos().slice(1, -1)).toEqual([
      'Página 1',
      '…',
      'Página 4',
      'Página 5',
      'Página 6',
      '…',
      'Página 9',
    ]);
  });

  it('emite la pagina pedida y las filas por pagina, sin salirse de los limites', () => {
    const botones = html.querySelectorAll<HTMLButtonElement>('.paginacion button');
    botones[0].click(); // anterior, deshabilitado en la primera
    botones[2].click(); // pagina 2
    botones[botones.length - 1].click(); // siguiente
    expect(fixture.componentInstance.pedidas).toEqual([1, 1]);

    const select = html.querySelector('select')!;
    select.value = '25';
    select.dispatchEvent(new Event('change'));
    expect(fixture.componentInstance.tamanos).toEqual([25]);
  });

  it('con pocas filas queda solo el resumen; sin filas, nada', () => {
    fixture.componentInstance.total.set(4);
    fixture.componentInstance.paginas.set(1);
    fixture.detectChanges();
    expect(html.querySelector('.paginacion-pie__resumen')?.textContent).toBe('Mostrando 1–4 de 4');
    expect(html.querySelector('select')).toBeNull();
    expect(html.querySelector('nav')).toBeNull();

    fixture.componentInstance.total.set(0);
    fixture.detectChanges();
    expect(html.querySelector('.paginacion-pie__resumen')).toBeNull();
  });

  it('sin total se comporta como antes: solo botones y solo con mas de una pagina', () => {
    fixture.componentInstance.total.set(null);
    fixture.componentInstance.porPagina.set(null);
    fixture.detectChanges();
    expect(html.querySelector('.paginacion-pie__resumen')).toBeNull();
    expect(html.querySelector('nav')?.getAttribute('aria-label')).toBe('Páginas de sedes');

    fixture.componentInstance.paginas.set(1);
    fixture.detectChanges();
    expect(html.querySelector('nav')).toBeNull();
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      await esperarSinViolaciones(html);
    },
    TIMEOUT_AXE,
  );
});
