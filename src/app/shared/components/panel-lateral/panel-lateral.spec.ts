import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PanelLateral } from './panel-lateral';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../core/testing/axe';

@Component({
  imports: [PanelLateral],
  template: `
    <button type="button" id="abrir" (click)="abierto.set(true)">Editar</button>
    @if (abierto()) {
      <app-panel-lateral
        titulo="Editar Centro Norte"
        subtitulo="Sede"
        (cerrar)="cerrados = cerrados + 1"
      >
        <p panel-subtitulo id="contexto">Con ayuda</p>
        <form>
          <div class="campo">
            <label for="nombre">Nombre</label>
            <input id="nombre" />
          </div>
          <div class="acciones">
            <button type="button" (click)="abierto.set(false)">Cancelar</button>
            <button type="submit">Guardar</button>
          </div>
        </form>
      </app-panel-lateral>
    }
  `,
})
class Anfitrion {
  readonly abierto = signal(false);
  cerrados = 0;
}

/**
 * Panel lateral: se abre como dialogo nombrado por su titulo, enfoca el primer campo, Escape y el
 * boton de cerrar avisan sin cerrarse solos, y al destruirse devuelve el foco a quien lo abrio.
 */
describe('PanelLateral', () => {
  let fixture: ComponentFixture<Anfitrion>;
  let html: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(Anfitrion);
    fixture.detectChanges();
    html = fixture.nativeElement as HTMLElement;
    document.body.appendChild(html);
  });

  afterEach(() => html.remove());

  const dialogo = () => html.querySelector<HTMLDialogElement>('dialog.panel-lateral');

  async function abrir(): Promise<void> {
    const boton = html.querySelector<HTMLButtonElement>('#abrir')!;
    boton.focus();
    boton.click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('se abre como dialogo nombrado por el titulo y enfoca el primer campo', async () => {
    await abrir();

    const panel = dialogo()!;
    expect(panel.hasAttribute('open')).toBe(true);
    const titulo = html.querySelector(`#${panel.getAttribute('aria-labelledby')}`);
    expect(titulo?.textContent).toBe('Editar Centro Norte');
    expect(panel.textContent).toContain('Sede');
    expect(panel.querySelector('.panel-lateral__titulos #contexto')).not.toBeNull();
    expect(document.activeElement?.id).toBe('nombre');
  });

  it('Escape y el boton de cerrar avisan, sin cerrarse solos', async () => {
    await abrir();

    const cancelar = new Event('cancel', { cancelable: true });
    dialogo()!.dispatchEvent(cancelar);
    expect(cancelar.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.cerrados).toBe(1);

    html.querySelector<HTMLButtonElement>('.panel-lateral__cerrar')!.click();
    expect(fixture.componentInstance.cerrados).toBe(2);
    expect(dialogo()).not.toBeNull();
  });

  it('al quitarse devuelve el foco al boton que lo abrio', async () => {
    await abrir();

    fixture.componentInstance.abierto.set(false);
    fixture.detectChanges();
    await Promise.resolve();

    expect(dialogo()).toBeNull();
    expect(document.activeElement?.id).toBe('abrir');
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      await abrir();
      await esperarSinViolaciones(html);
    },
    TIMEOUT_AXE,
  );
});
