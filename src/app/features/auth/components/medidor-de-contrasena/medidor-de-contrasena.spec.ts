import { TestBed } from '@angular/core/testing';

import { MedidorDeContrasena } from './medidor-de-contrasena';

describe('MedidorDeContrasena', () => {
  async function montar(valor: string) {
    const fixture = TestBed.createComponent(MedidorDeContrasena);
    fixture.componentRef.setInput('valor', valor);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('sin nada escrito sugiere los tres puntos y no llena la barra', async () => {
    const raiz = await montar('');
    expect(raiz.querySelectorAll('.medidor__tramo--lleno').length).toBe(0);
    expect(raiz.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'al menos 10 caracteres',
    );
    expect(raiz.querySelector('.medidor__barra')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('marca lo cumplido y lo que falta con letras y números pero poco largo', async () => {
    const raiz = await montar('abc123');
    expect(raiz.querySelectorAll('.medidor__tramo--lleno').length).toBe(2);
    const resumen = raiz.querySelector('[aria-live="polite"]')?.textContent ?? '';
    expect(resumen).toContain('al menos 10 caracteres');
    expect(resumen).not.toContain('letras');
  });

  it('con las tres sugerencias cumplidas llena la barra y recuerda que decide el sistema', async () => {
    const raiz = await montar('clave-larga-2026');
    expect(raiz.querySelectorAll('.medidor__tramo--lleno').length).toBe(3);
    expect(raiz.querySelector('[aria-live="polite"]')?.textContent).toContain('El sistema valida');
  });
});
