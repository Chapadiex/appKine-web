import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TablaDeDetalle } from './tabla-de-detalle';

/**
 * Tabla de detalle de una seccion del reporte (UX-14): ordena por cualquier columna -los importes
 * como numero- y pagina de a 10 con el pie estandar.
 */
describe('TablaDeDetalle', () => {
  async function montar(filas: readonly (readonly string[])[]) {
    await TestBed.configureTestingModule({ imports: [TablaDeDetalle] }).compileComponents();
    const fixture = TestBed.createComponent(TablaDeDetalle);
    fixture.componentRef.setInput('columnas', ['Servicio', 'Cobrado']);
    fixture.componentRef.setInput('filas', filas);
    fixture.componentRef.setInput('etiqueta', 'Detalle de Cobros');
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  function primeraColumna(fixture: ComponentFixture<TablaDeDetalle>): string[] {
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')].map(
      (fila) => fila.querySelector('td')?.textContent?.trim() ?? '',
    );
  }

  function ordenarPor(fixture: ComponentFixture<TablaDeDetalle>, columna: string): void {
    const botones = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      'th button',
    );
    [...botones].find((b) => b.textContent?.includes(columna))?.click();
    fixture.detectChanges();
  }

  it('ordena un importe como número y no como texto', async () => {
    const fixture = await montar([
      ['Pilates', '900.00'],
      ['Kinesiología', '10000.00'],
      ['Yoga', '50.00'],
    ]);

    ordenarPor(fixture, 'Cobrado');
    expect(primeraColumna(fixture)).toEqual(['Yoga', 'Pilates', 'Kinesiología']);
    const th = (fixture.nativeElement as HTMLElement).querySelectorAll('th')[1];
    expect(th.getAttribute('aria-sort')).toBe('ascending');

    ordenarPor(fixture, 'Cobrado');
    expect(primeraColumna(fixture)).toEqual(['Kinesiología', 'Pilates', 'Yoga']);
  });

  it('pagina de a 10 con el pie estándar', async () => {
    const filas = Array.from({ length: 23 }, (_, i) => [`Servicio ${i + 1}`, `${i + 1}.00`]);
    const fixture = await montar(filas);
    const raiz = fixture.nativeElement as HTMLElement;

    expect(raiz.querySelectorAll('tbody tr')).toHaveLength(10);
    expect(raiz.querySelector('.paginacion-pie__resumen')?.textContent).toContain(
      'Mostrando 1–10 de 23',
    );
    expect(raiz.querySelector('nav')?.getAttribute('aria-label')).toBe(
      'Páginas de Detalle de Cobros',
    );
    expect(raiz.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe(
      'Detalle de Cobros',
    );
    // El importe se ve con separadores de es-AR y alineado a la derecha.
    expect(raiz.querySelector('td.importe')).not.toBeNull();
  });
});
