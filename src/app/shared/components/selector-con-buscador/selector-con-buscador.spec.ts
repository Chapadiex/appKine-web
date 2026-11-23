import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { GrupoDeSelector, SelectorConBuscador } from './selector-con-buscador';

const GRUPOS: readonly GrupoDeSelector[] = [
  {
    etiqueta: 'Kinesiología neurológica',
    opciones: [
      { valor: '1', etiqueta: 'Rehabilitación de ACV' },
      { valor: '2', etiqueta: 'Método Bobath' },
    ],
  },
  {
    etiqueta: 'Pilates y disciplinas relacionadas',
    opciones: [{ valor: '3', etiqueta: 'Pilates reformer' }],
  },
];

@Component({
  imports: [SelectorConBuscador, ReactiveFormsModule],
  template: `
    <label for="servicio">Servicio</label>
    <app-selector-con-buscador
      idCampo="servicio"
      [grupos]="grupos"
      [formControl]="control"
      (elegido)="elegidos.push($event)"
    />
  `,
})
class Host {
  readonly grupos = GRUPOS;
  readonly control = new FormControl<string | null>('2');
  readonly elegidos: string[] = [];
}

async function asentar(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('SelectorConBuscador', () => {
  let fixture: ComponentFixture<Host>;
  let campo: HTMLInputElement;

  const opciones = () =>
    [...fixture.nativeElement.querySelectorAll('[role="option"]')] as HTMLElement[];
  const grupos = () =>
    [...fixture.nativeElement.querySelectorAll('.selector-con-buscador__grupo')].map((g) =>
      (g as HTMLElement).textContent?.trim(),
    );
  const tecla = async (key: string) => {
    campo.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
    await asentar(fixture);
  };
  const escribir = async (texto: string) => {
    campo.value = texto;
    campo.dispatchEvent(new Event('input'));
    await asentar(fixture);
  };

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await asentar(fixture);
    campo = fixture.nativeElement.querySelector('input');
  });

  it('muestra la etiqueta de lo elegido y abre la lista entera al enfocar', async () => {
    expect(campo.value).toBe('Método Bobath');
    campo.dispatchEvent(new Event('focus'));
    await asentar(fixture);
    expect(campo.getAttribute('aria-expanded')).toBe('true');
    expect(opciones()).toHaveLength(3);
    expect(grupos()).toEqual(['Kinesiología neurológica', 'Pilates y disciplinas relacionadas']);
    expect(opciones()[1].getAttribute('aria-selected')).toBe('true');
  });

  it('filtra sin acentos ni mayúsculas, por opción o por grupo', async () => {
    await escribir('pilates');
    expect(opciones().map((o) => o.textContent?.trim())).toEqual(['Pilates reformer']);

    await escribir('NEUROLOGICA');
    expect(opciones()).toHaveLength(2);

    await escribir('nada que ver');
    expect(opciones()).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('No hay coincidencias para «nada que ver»');
  });

  it('las flechas recorren en círculo y Enter elige sin enviar el formulario', async () => {
    await escribir('a');
    await tecla('ArrowUp');
    expect(campo.getAttribute('aria-activedescendant')).toMatch(/-2$/);
    await tecla('ArrowDown');
    expect(campo.getAttribute('aria-activedescendant')).toMatch(/-0$/);

    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    campo.dispatchEvent(enter);
    await asentar(fixture);

    expect(enter.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.control.value).toBe('1');
    expect(fixture.componentInstance.elegidos).toEqual(['1']);
    expect(campo.value).toBe('Rehabilitación de ACV');
    expect(campo.getAttribute('aria-expanded')).toBe('false');
  });

  it('sin coincidencias las flechas no marcan nada y Enter no hace nada', async () => {
    await escribir('zzz');
    await tecla('ArrowDown');
    await tecla('ArrowUp');
    expect(campo.getAttribute('aria-activedescendant')).toBeNull();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    campo.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(fixture.componentInstance.control.value).toBe('2');
  });

  it('Escape cierra, y salir sin elegir vuelve a mostrar lo elegido y marca tocado', async () => {
    await escribir('pil');
    await tecla('Escape');
    expect(campo.getAttribute('aria-expanded')).toBe('false');

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    campo.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);

    campo.dispatchEvent(new Event('blur'));
    await asentar(fixture);
    expect(campo.value).toBe('Método Bobath');
    expect(fixture.componentInstance.control.touched).toBe(true);
  });

  it('un clic en una opción la elige', async () => {
    campo.dispatchEvent(new Event('click'));
    await asentar(fixture);
    opciones()[2].click();
    await asentar(fixture);
    expect(fixture.componentInstance.control.value).toBe('3');
    expect(campo.value).toBe('Pilates reformer');
  });

  it('acepta valores nulos o desconocidos y se deshabilita con el control', async () => {
    fixture.componentInstance.control.setValue(null);
    await asentar(fixture);
    expect(campo.value).toBe('');

    fixture.componentInstance.control.setValue('99');
    await asentar(fixture);
    expect(campo.value).toBe('');

    fixture.componentInstance.control.disable();
    await asentar(fixture);
    expect(campo.disabled).toBe(true);
  });
});
