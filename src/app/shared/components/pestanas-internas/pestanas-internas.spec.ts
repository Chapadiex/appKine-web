import { TestBed } from '@angular/core/testing';

import { PestanasInternas } from './pestanas-internas';

async function montar() {
  const fixture = TestBed.createComponent(PestanasInternas);
  fixture.componentRef.setInput('pestanas', [
    { id: 'uno', etiqueta: 'Uno' },
    { id: 'dos', etiqueta: 'Dos' },
    { id: 'tres', etiqueta: 'Tres' },
  ]);
  fixture.componentRef.setInput('etiqueta', 'Partes');
  fixture.componentRef.setInput('activa', 'uno');
  await fixture.whenStable();
  const pestanas = (): HTMLButtonElement[] => [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ];
  return { fixture, pestanas };
}

describe('PestanasInternas', () => {
  it('un click activa la pestaña', async () => {
    const { fixture, pestanas } = await montar();
    pestanas()[2].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.activa()).toBe('tres');
  });

  it('flecha derecha activa la siguiente y le da el foco', async () => {
    const { fixture, pestanas } = await montar();
    pestanas()[0].focus();
    pestanas()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.activa()).toBe('dos');
    expect(document.activeElement).toBe(pestanas()[1]);
  });

  it('marca aria-selected y apunta al panel', async () => {
    const { pestanas } = await montar();
    expect(pestanas()[0].getAttribute('aria-selected')).toBe('true');
    expect(pestanas()[1].getAttribute('aria-selected')).toBe('false');
    expect(pestanas()[0].getAttribute('aria-controls')).toBe('panel-uno');
  });
});
