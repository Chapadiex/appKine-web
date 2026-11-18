import { TestBed } from '@angular/core/testing';

import { Segmentado } from './segmentado';

describe('Segmentado', () => {
  it('elegir una opción emite su valor', async () => {
    const fixture = TestBed.createComponent(Segmentado);
    fixture.componentRef.setInput('opciones', [
      { valor: 'RAPIDA', etiqueta: 'Rápida' },
      { valor: 'COMPLETA', etiqueta: 'Completa' },
    ]);
    fixture.componentRef.setInput('etiqueta', 'Modo');
    await fixture.whenStable();
    const radios = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
      'input',
    );
    radios[1].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.valor()).toBe('COMPLETA');
  });
});
