import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { BuscadorConAlta } from './buscador-con-alta';

const PROFESIONES = [
  'Kinesiología',
  'Fisioterapia',
  'Fonoaudiología',
  'Nutrición',
  'Psicología',
  'Terapia ocupacional',
  'Odontología',
  'Medicina deportiva',
  'Enfermería',
  'Podología',
];

@Component({
  imports: [BuscadorConAlta, ReactiveFormsModule],
  template: `
    <label for="profesion">Profesión</label>
    <app-buscador-con-alta
      idCampo="profesion"
      placeholder="Buscar o escribir"
      [formControl]="control"
      [opciones]="opciones"
    />
  `,
})
class HostDeFormulario {
  readonly control = new FormControl<string | null>('Kinesiología');
  readonly opciones = PROFESIONES;
}

@Component({
  imports: [BuscadorConAlta],
  template: `
    <label for="especialidad">Especialidad</label>
    <app-buscador-con-alta
      idCampo="especialidad"
      limpiarAlElegir
      [opciones]="opciones()"
      [excluir]="excluir()"
      (elegido)="elegidos.push($event)"
    />
  `,
})
class HostDeLista {
  readonly opciones = signal<readonly string[]>(['Deportiva', 'Neurológica', 'Respiratoria']);
  readonly excluir = signal<readonly string[]>(['neurologica']);
  readonly elegidos: string[] = [];
}

async function asentar(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function campo(fixture: ComponentFixture<unknown>): HTMLInputElement {
  return (fixture.nativeElement as HTMLElement).querySelector(
    'input[role="combobox"]',
  ) as HTMLInputElement;
}

function opciones(fixture: ComponentFixture<unknown>): string[] {
  return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[role="option"]')).map(
    (o) => (o.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

async function escribir(fixture: ComponentFixture<unknown>, texto: string): Promise<void> {
  const input = campo(fixture);
  input.dispatchEvent(new Event('focus'));
  input.value = texto;
  input.dispatchEvent(new Event('input'));
  await asentar(fixture);
}

/** Despacha la tecla y devuelve si el componente la consumio (`preventDefault`). */
async function tecla(fixture: ComponentFixture<unknown>, key: string): Promise<boolean> {
  const evento = new KeyboardEvent('keydown', { key, cancelable: true });
  campo(fixture).dispatchEvent(evento);
  await asentar(fixture);
  return evento.defaultPrevented;
}

describe('BuscadorConAlta', () => {
  describe('como control de formulario', () => {
    let fixture: ComponentFixture<HostDeFormulario>;
    let host: HostDeFormulario;

    beforeEach(async () => {
      fixture = TestBed.createComponent(HostDeFormulario);
      host = fixture.componentInstance;
      await asentar(fixture);
    });

    it('muestra el valor del control, y nada si el control queda en null', async () => {
      expect(campo(fixture).value).toBe('Kinesiología');
      expect(campo(fixture).id).toBe('profesion');
      host.control.setValue(null);
      await asentar(fixture);
      expect(campo(fixture).value).toBe('');
    });

    it('al enfocar sin texto ofrece hasta ocho valores conocidos y ninguno para agregar', async () => {
      host.control.setValue('');
      await asentar(fixture);
      campo(fixture).dispatchEvent(new Event('focus'));
      await asentar(fixture);
      expect(campo(fixture).getAttribute('aria-expanded')).toBe('true');
      expect(opciones(fixture)).toEqual(PROFESIONES.slice(0, 8));
    });

    it('busca sin mayúsculas ni acentos y ofrece agregar lo que no está', async () => {
      await escribir(fixture, 'LOGIA');
      expect(opciones(fixture)).toEqual([
        'Kinesiología',
        'Fonoaudiología',
        'Psicología',
        'Odontología',
        'Podología',
        'Agregar «LOGIA»',
      ]);
      // Lo escrito a mano ya es el valor, sin elegirlo de la lista.
      expect(host.control.value).toBe('LOGIA');

      // Escrito exacto (sin acentos), no se ofrece agregarlo otra vez.
      await escribir(fixture, '  kinesiologia ');
      expect(opciones(fixture)).toEqual(['Kinesiología']);
      expect(host.control.value).toBe('kinesiologia');
    });

    it('las flechas recorren la lista en círculo y Enter elige sin enviar el formulario', async () => {
      await escribir(fixture, 'fo');
      expect(opciones(fixture)).toEqual(['Fonoaudiología', 'Agregar «fo»']);
      expect(campo(fixture).getAttribute('aria-activedescendant')).toBeNull();

      expect(await tecla(fixture, 'ArrowDown')).toBe(true);
      expect(await tecla(fixture, 'ArrowDown')).toBe(true);
      expect(await tecla(fixture, 'ArrowDown')).toBe(true);
      // Tres pasos sobre dos opciones: vuelve a la primera.
      const activa = (fixture.nativeElement as HTMLElement).querySelector(
        '.buscador-con-alta__opcion--activa',
      ) as HTMLElement;
      expect(activa.textContent).toContain('Fonoaudiología');
      expect(activa.getAttribute('aria-selected')).toBe('true');
      expect(campo(fixture).getAttribute('aria-activedescendant')).toBe(activa.id);

      // Hacia arriba desde la primera va a la ultima: agregar lo escrito.
      expect(await tecla(fixture, 'ArrowUp')).toBe(true);
      expect(await tecla(fixture, 'Enter')).toBe(true);
      expect(host.control.value).toBe('fo');
      expect(campo(fixture).value).toBe('fo');
      expect(opciones(fixture)).toEqual([]);
      expect(campo(fixture).getAttribute('aria-expanded')).toBe('false');
    });

    it('Enter sin opción marcada no elige nada y deja seguir al formulario', async () => {
      await escribir(fixture, 'Nutri');
      expect(await tecla(fixture, 'Enter')).toBe(false);
      expect(opciones(fixture)).toEqual(['Nutrición', 'Agregar «Nutri»']);
      expect(host.control.value).toBe('Nutri');
    });

    it('un clic en una opción la elige como valor', async () => {
      await escribir(fixture, 'fisio');
      const opcion = (fixture.nativeElement as HTMLElement).querySelector(
        '[role="option"]',
      ) as HTMLElement;
      const mousedown = new MouseEvent('mousedown', { cancelable: true });
      opcion.dispatchEvent(mousedown);
      // El mousedown no le saca el foco al campo antes del clic.
      expect(mousedown.defaultPrevented).toBe(true);
      opcion.click();
      await asentar(fixture);
      expect(host.control.value).toBe('Fisioterapia');
      expect(campo(fixture).value).toBe('Fisioterapia');
      expect(opciones(fixture)).toEqual([]);
    });

    it('Escape cierra la lista, y con la lista cerrada no se lo come', async () => {
      await escribir(fixture, 'enf');
      expect(await tecla(fixture, 'Escape')).toBe(true);
      expect(opciones(fixture)).toEqual([]);
      expect(await tecla(fixture, 'Escape')).toBe(false);
      // Abajo vuelve a abrirla.
      await tecla(fixture, 'ArrowDown');
      expect(opciones(fixture)).toEqual(['Enfermería', 'Agregar «enf»']);
    });

    it('al salir del campo cierra la lista y marca el control como tocado', async () => {
      await escribir(fixture, 'psi');
      expect(host.control.touched).toBe(false);
      campo(fixture).dispatchEvent(new Event('blur'));
      await asentar(fixture);
      expect(host.control.touched).toBe(true);
      expect(opciones(fixture)).toEqual([]);
    });

    it('se deshabilita con el control', async () => {
      host.control.disable();
      await asentar(fixture);
      expect(campo(fixture).disabled).toBe(true);
      host.control.enable();
      await asentar(fixture);
      expect(campo(fixture).disabled).toBe(false);
    });
  });

  describe('para sumar a una lista (limpiarAlElegir)', () => {
    let fixture: ComponentFixture<HostDeLista>;
    let host: HostDeLista;

    beforeEach(async () => {
      fixture = TestBed.createComponent(HostDeLista);
      host = fixture.componentInstance;
      await asentar(fixture);
    });

    it('no ofrece lo ya elegido, ni para agregarlo de nuevo', async () => {
      campo(fixture).dispatchEvent(new Event('focus'));
      await asentar(fixture);
      expect(opciones(fixture)).toEqual(['Deportiva', 'Respiratoria']);

      await escribir(fixture, 'Neurológica');
      expect(opciones(fixture)).toEqual([]);
      expect(await tecla(fixture, 'ArrowDown')).toBe(true);
      expect(campo(fixture).getAttribute('aria-activedescendant')).toBeNull();
    });

    it('Enter con texto suelto lo agrega y el campo queda vacío', async () => {
      await escribir(fixture, '  Pediatría ');
      expect(opciones(fixture)).toEqual(['Agregar «Pediatría»']);
      expect(await tecla(fixture, 'Enter')).toBe(true);
      expect(host.elegidos).toEqual(['Pediatría']);
      expect(campo(fixture).value).toBe('');

      // Con el campo vacio, Enter no agrega nada.
      expect(await tecla(fixture, 'Enter')).toBe(false);
      expect(host.elegidos).toEqual(['Pediatría']);
    });

    it('elegir una opción la emite y vacía el campo', async () => {
      await escribir(fixture, 'resp');
      (
        (fixture.nativeElement as HTMLElement).querySelector('[role="option"]') as HTMLElement
      ).click();
      await asentar(fixture);
      expect(host.elegidos).toEqual(['Respiratoria']);
      expect(campo(fixture).value).toBe('');

      // Excluirla despues de elegirla la saca de la lista.
      host.excluir.set(['neurologica', 'Respiratoria']);
      campo(fixture).dispatchEvent(new Event('focus'));
      await asentar(fixture);
      expect(opciones(fixture)).toEqual(['Deportiva']);
    });
  });
});
