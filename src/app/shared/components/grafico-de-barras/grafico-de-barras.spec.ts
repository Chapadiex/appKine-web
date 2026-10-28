import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BarraDeGrafico, GraficoDeBarras, techoRedondo } from './grafico-de-barras';

const BARRAS: readonly BarraDeGrafico[] = [
  { etiqueta: '01/09', detalle: '01/09/2026', valor: 1000, texto: '$ 1.000,00' },
  { etiqueta: '02/09', detalle: '02/09/2026', valor: 0, texto: '$ 0,00' },
  { etiqueta: '03/09', detalle: '03/09/2026', valor: 500, texto: '$ 500,00' },
];

/**
 * Lo que decide comportamiento del grafico: la escala redonda, el teclado que recorre las barras
 * y lee el valor (lo mismo que el globo del puntero), y que sin valores no dibuje un piso vacio.
 */
describe('GraficoDeBarras', () => {
  it('el tope del eje es un número redondo que no queda debajo del máximo', () => {
    expect(techoRedondo(0)).toBe(1);
    expect(techoRedondo(3)).toBe(5);
    expect(techoRedondo(1000)).toBe(1000);
    expect(techoRedondo(1001)).toBe(2000);
    expect(techoRedondo(2300)).toBe(2500);
    expect(techoRedondo(7.2)).toBe(10);
  });

  it('las flechas recorren las barras y la región viva lee la activa', () => {
    const fixture = montar(BARRAS);
    const html = fixture.nativeElement as HTMLElement;
    const lienzo = html.querySelector<HTMLElement>('[role="group"]')!;

    lienzo.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    expect(lectura(html)).toBe('03/09/2026: $ 500,00');

    teclear(fixture, lienzo, 'Home');
    expect(lectura(html)).toBe('01/09/2026: $ 1.000,00');
    expect(html.querySelector('.grafico__globo')?.textContent).toContain('$ 1.000,00');

    teclear(fixture, lienzo, 'ArrowRight');
    expect(lectura(html)).toBe('02/09/2026: $ 0,00');

    lienzo.dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();
    expect(lectura(html)).toBe('');
    expect(html.querySelector('.grafico__globo')).toBeNull();
  });

  it('la barra más alta llena el eje y el primer y último día van rotulados', () => {
    const html = montar(BARRAS).nativeElement as HTMLElement;
    const barras = [...html.querySelectorAll<HTMLElement>('.grafico__barra')];
    expect(barras.map((b) => b.style.height)).toEqual(['100%', '0%', '50%']);
    const rotulos = [...html.querySelectorAll('.grafico__rotulo')].map((r) => r.textContent);
    expect(rotulos[0]).toBe('01/09');
    expect(rotulos.at(-1)).toBe('03/09');
  });

  it('sin valores lo dice en vez de dibujar barras vacías', () => {
    const html = montar([{ ...BARRAS[1] }]).nativeElement as HTMLElement;
    expect(html.textContent).toContain('Sin valores en el período.');
    expect(html.querySelector('[role="group"]')).toBeNull();
  });

  // ------------------------------------------------------------------------------------

  function montar(barras: readonly BarraDeGrafico[]): ComponentFixture<GraficoDeBarras> {
    const fixture = TestBed.createComponent(GraficoDeBarras);
    fixture.componentRef.setInput('barras', barras);
    fixture.componentRef.setInput('descripcion', 'Barras de prueba');
    fixture.detectChanges();
    return fixture;
  }

  function teclear(fixture: ComponentFixture<GraficoDeBarras>, lienzo: HTMLElement, key: string) {
    lienzo.dispatchEvent(new KeyboardEvent('keydown', { key }));
    fixture.detectChanges();
  }

  function lectura(html: HTMLElement): string {
    return (html.querySelector('[aria-live]')?.textContent ?? '').trim();
  }
});
