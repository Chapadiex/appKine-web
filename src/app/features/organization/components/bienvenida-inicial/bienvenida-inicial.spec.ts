import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ContratacionStore } from '../../../../core/services/contratacion.store';
import { BienvenidaInicial } from './bienvenida-inicial';

describe('BienvenidaInicial', () => {
  function montar(dias: number | null, planNombre: string): HTMLElement {
    TestBed.configureTestingModule({
      imports: [BienvenidaInicial],
      providers: [
        {
          provide: ContratacionStore,
          useValue: { diasDePrueba: signal(dias), contratacion: signal({ planNombre }) },
        },
      ],
    });
    const fixture = TestBed.createComponent(BienvenidaInicial);
    fixture.componentRef.setInput('nombreCentro', 'Centro Sur');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('en la prueba gratis dice cuántos días quedan y agradece por el centro', () => {
    const anfitrion = montar(12, 'Plan Base');

    expect(anfitrion.querySelector('.bienvenida__plan')?.textContent).toContain('quedan 12 días');
    expect(anfitrion.textContent).toContain('Gracias por elegirnos para Centro Sur');
  });

  it('con un plan contratado lo muestra activo', () => {
    const anfitrion = montar(null, 'Plan Crecimiento');

    expect(anfitrion.querySelector('.bienvenida__plan--activo')?.textContent).toContain(
      'Plan Crecimiento activo',
    );
  });
});
