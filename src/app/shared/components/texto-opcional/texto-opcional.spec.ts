import { TestBed } from '@angular/core/testing';

import { TextoOpcional } from './texto-opcional';

async function montar() {
  const fixture = TestBed.createComponent(TextoOpcional);
  fixture.componentRef.setInput('idCampo', 'nota');
  fixture.componentRef.setInput('etiqueta', 'Nota');
  await fixture.whenStable();
  return fixture;
}

describe('TextoOpcional', () => {
  it('el rótulo dice opcional y el campo no es obligatorio', async () => {
    const fixture = await montar();
    const raiz = fixture.nativeElement as HTMLElement;
    expect(raiz.querySelector('label')?.textContent).toContain('(opcional)');
    expect(raiz.querySelector('input')?.required).toBe(false);
  });

  it('al salir del campo confirma lo escrito', async () => {
    const fixture = await montar();
    const confirmados: string[] = [];
    fixture.componentInstance.confirmado.subscribe((v) => confirmados.push(v));
    const campo = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    campo.value = 'dolor al subir escaleras';
    campo.dispatchEvent(new Event('input'));
    campo.dispatchEvent(new Event('blur'));
    expect(confirmados).toEqual(['dolor al subir escaleras']);
  });
});
