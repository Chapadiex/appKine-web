import { TestBed } from '@angular/core/testing';

import { Chips, OpcionChip } from './chips';

const OPCIONES: readonly OpcionChip[] = [
  { valor: 'A', etiqueta: 'Alfa' },
  { valor: 'B', etiqueta: 'Beta' },
  { valor: 'C', etiqueta: 'Gamma' },
];

async function montar(multiple = false) {
  const fixture = TestBed.createComponent(Chips);
  fixture.componentRef.setInput('opciones', OPCIONES);
  fixture.componentRef.setInput('etiqueta', 'Prueba');
  fixture.componentRef.setInput('multiple', multiple);
  await fixture.whenStable();
  const botones = (): HTMLButtonElement[] => [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
  ];
  return { fixture, botones };
}

describe('Chips', () => {
  it('elegir uno emite su valor y lo marca pulsado', async () => {
    const { fixture, botones } = await montar();
    botones()[1].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.valor()).toBe('B');
    expect(botones()[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('tocar el elegido otra vez lo deja en null', async () => {
    const { fixture, botones } = await montar();
    botones()[1].click();
    botones()[1].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.valor()).toBeNull();
  });

  it('en múltiple acumula los elegidos', async () => {
    const { fixture, botones } = await montar(true);
    botones()[0].click();
    botones()[2].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.valor()).toEqual(['A', 'C']);
  });

  it('flecha derecha mueve el foco al siguiente', async () => {
    const { fixture, botones } = await montar();
    botones()[0].focus();
    botones()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await fixture.whenStable();
    expect(document.activeElement).toBe(botones()[1]);
  });
});
