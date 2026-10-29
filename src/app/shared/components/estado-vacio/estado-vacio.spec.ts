import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { EstadoVacio } from './estado-vacio';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../core/testing/axe';

@Component({
  imports: [EstadoVacio],
  template: `
    <app-estado-vacio titulo="No hay sedes todavía" texto="Abrí la primera para empezar.">
      <button type="button" class="boton">Abrir una sede</button>
    </app-estado-vacio>
  `,
})
class Anfitrion {}

describe('EstadoVacio', () => {
  it(
    'dice que paso, que hacer y ofrece la salida; se anuncia',
    async () => {
      const fixture = TestBed.createComponent(Anfitrion);
      fixture.detectChanges();
      const html = fixture.nativeElement as HTMLElement;
      const vacio = html.querySelector('app-estado-vacio')!;
      expect(vacio.getAttribute('role')).toBe('status');
      expect(vacio.querySelector('.estado-vacio__titulo')?.textContent).toBe(
        'No hay sedes todavía',
      );
      expect(vacio.querySelector('.estado-vacio__texto')?.textContent).toBe(
        'Abrí la primera para empezar.',
      );
      expect(vacio.querySelector('.estado-vacio__acciones button')?.textContent).toBe(
        'Abrir una sede',
      );
      await esperarSinViolaciones(html);
    },
    TIMEOUT_AXE,
  );
});
