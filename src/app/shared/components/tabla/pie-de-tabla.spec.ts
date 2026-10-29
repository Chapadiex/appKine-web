import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { PieDeTabla } from './pie-de-tabla';
import { tablaLocal } from './tabla-local';

@Component({
  imports: [PieDeTabla],
  template: `<app-pie-de-tabla [tabla]="tabla" etiqueta="Páginas de prueba" />`,
})
class Anfitrion {
  readonly tabla = tablaLocal(signal(Array.from({ length: 37 }, (_, i) => ({ id: i }))), {
    columnas: {},
  });
}

describe('PieDeTabla', () => {
  it('cablea la tabla local: resumen, paginas y filas por pagina', () => {
    const fixture = TestBed.createComponent(Anfitrion);
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    const tabla = fixture.componentInstance.tabla;

    expect(html.querySelector('.paginacion-pie__resumen')?.textContent).toBe(
      'Mostrando 1–10 de 37',
    );
    html.querySelectorAll<HTMLButtonElement>('.paginacion button')[2].click();
    fixture.detectChanges();
    expect(tabla.pagina()).toBe(1);
    expect(html.querySelector('.paginacion-pie__resumen')?.textContent).toBe(
      'Mostrando 11–20 de 37',
    );

    const select = html.querySelector('select')!;
    select.value = '50';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(tabla.porPagina()).toBe(50);
    expect(html.querySelector('.paginacion-pie__resumen')?.textContent).toBe(
      'Mostrando 1–37 de 37',
    );
  });
});
