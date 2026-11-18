import { TestBed } from '@angular/core/testing';

import { Escala } from './escala';

async function montar() {
  const fixture = TestBed.createComponent(Escala);
  fixture.componentRef.setInput('etiqueta', 'Dolor');
  await fixture.whenStable();
  const botones = (): HTMLButtonElement[] => [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
  ];
  return { fixture, botones };
}

describe('Escala', () => {
  it('tiene once botones de 0 a 10', async () => {
    const { botones } = await montar();
    expect(botones().map((b) => b.textContent?.trim())).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
  });

  it('tocar 7 emite 7', async () => {
    const { fixture, botones } = await montar();
    botones()[7].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.valor()).toBe(7);
    expect(botones()[7].getAttribute('aria-pressed')).toBe('true');
  });

  it('tocar el elegido lo deja en null', async () => {
    const { fixture, botones } = await montar();
    botones()[7].click();
    botones()[7].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.valor()).toBeNull();
  });
});
