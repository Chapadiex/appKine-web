import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Alerta } from './alerta';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../core/testing/axe';

@Component({
  imports: [Alerta],
  template: `
    <app-alerta tipo="advertencia" titulo="Esta persona ya está registrada">
      <p>Exequiel Prueba · DNI 30.111.222</p>
      <a href="/pacientes/1">Ver persona</a>
    </app-alerta>
    <app-alerta tipo="info">Sin título</app-alerta>
  `,
})
class Anfitrion {}

describe('Alerta', () => {
  it('dice su severidad con rol, icono y titulo, y proyecta su contenido', () => {
    const fixture = TestBed.createComponent(Anfitrion);
    fixture.detectChanges();
    const [advertencia, info] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-alerta'),
    );

    expect(advertencia!.getAttribute('role')).toBe('alert');
    expect(advertencia!.classList).toContain('alerta--advertencia');
    expect(advertencia!.querySelector('.alerta__titulo')?.textContent).toBe(
      'Esta persona ya está registrada',
    );
    expect(advertencia!.querySelector('a')?.textContent).toBe('Ver persona');
    expect(info!.getAttribute('role')).toBe('status');
    expect(info!.querySelector('.alerta__titulo')).toBeNull();
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = TestBed.createComponent(Anfitrion);
      fixture.detectChanges();
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );
});
