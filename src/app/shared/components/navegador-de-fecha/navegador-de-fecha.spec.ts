import { TestBed } from '@angular/core/testing';

import { NavegadorDeFecha } from './navegador-de-fecha';

describe('NavegadorDeFecha', () => {
  async function montar(entradas: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(NavegadorDeFecha);
    for (const [clave, valor] of Object.entries(entradas)) {
      fixture.componentRef.setInput(clave, valor);
    }
    await fixture.whenStable();
    const raiz = fixture.nativeElement as HTMLElement;
    const boton = (nombre: string) =>
      Array.from(raiz.querySelectorAll('button')).find(
        (b) => (b.textContent ?? '').trim() === nombre,
      );
    return { fixture, raiz, boton };
  }

  it('nombra las flechas por la unidad y emite cada movimiento', async () => {
    const { fixture, boton } = await montar({ unidad: 'semana' });
    const eventos: string[] = [];
    fixture.componentInstance.anterior.subscribe(() => eventos.push('anterior'));
    fixture.componentInstance.siguiente.subscribe(() => eventos.push('siguiente'));
    fixture.componentInstance.hoy.subscribe(() => eventos.push('hoy'));

    boton('Semana anterior')!.click();
    boton('Hoy')!.click();
    boton('Semana siguiente')!.click();

    expect(eventos).toEqual(['anterior', 'hoy', 'siguiente']);
  });

  it('anuncia el período y puede ocultar "Hoy"', async () => {
    const { raiz, boton } = await montar({ periodo: 'marzo de 2030', mostrarHoy: false });
    const periodo = raiz.querySelector('[aria-live="polite"]');
    expect(periodo?.textContent?.trim()).toBe('marzo de 2030');
    expect(boton('Hoy')).toBeUndefined();
    expect(raiz.getAttribute('role')).toBe('group');
  });
});
