import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ColumnaOrdenable } from './columna-ordenable';
import { ordenDeServidor } from './orden-de-servidor';

@Component({
  imports: [ColumnaOrdenable],
  template: `
    <table>
      <thead>
        <tr>
          <th scope="col" appOrdenable [tabla]="orden" columna="nombre">Nombre</th>
        </tr>
      </thead>
    </table>
  `,
})
class Anfitrion {
  pedidos = 0;
  readonly orden = ordenDeServidor<'nombre' | 'tipo'>(() => this.pedidos++);
}

/** Orden de una tabla paginada por el servidor: no ordena nada, arma el `sort` y avisa. */
describe('ordenDeServidor', () => {
  it('cicla asc → desc → orden por defecto, arma el sort y avisa en cada cambio', () => {
    let avisos = 0;
    const orden = ordenDeServidor<'nombre' | 'tipo'>(() => avisos++);
    expect(orden.sort()).toBeUndefined();

    orden.ordenarPor('nombre');
    expect(orden.sort()).toBe('nombre,asc');
    orden.ordenarPor('nombre');
    expect(orden.sort()).toBe('nombre,desc');
    orden.ordenarPor('nombre');
    expect(orden.sort()).toBeUndefined();
    orden.ordenarPor('tipo');
    expect(orden.sort()).toBe('tipo,asc');
    expect(avisos).toBe(4);

    orden.reiniciar();
    expect(orden.sort()).toBeUndefined();
    expect(avisos).toBe(4);
  });

  it('el encabezado pide el orden al servidor y aria-sort lo dice', () => {
    const fixture = TestBed.createComponent(Anfitrion);
    fixture.detectChanges();
    const th = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('th')!;

    th.querySelector('button')!.click();
    fixture.detectChanges();

    expect(th.getAttribute('aria-sort')).toBe('ascending');
    expect(fixture.componentInstance.orden.sort()).toBe('nombre,asc');
    expect(fixture.componentInstance.pedidos).toBe(1);
  });
});
