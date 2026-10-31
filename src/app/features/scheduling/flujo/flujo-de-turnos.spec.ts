import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideApi } from '../../../api/generated/provide-api';
import { FlujoDeTurnosStore } from '../../../core/services/flujo-de-turnos.store';
import { FlujoDeTurnos } from './flujo-de-turnos';

/**
 * El único punto que dibuja los paneles: lo que hace que muchos puntos de entrada terminen en un solo
 * flujo. Sin sede elegida los paneles no piden nada, que es lo que deja mirar solo el despacho.
 */
describe('FlujoDeTurnos', () => {
  let flujo: FlujoDeTurnosStore;
  let fixture: ComponentFixture<FlujoDeTurnos>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FlujoDeTurnos],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    flujo = TestBed.inject(FlujoDeTurnosStore);
    fixture = TestBed.createComponent(FlujoDeTurnos);
    fixture.detectChanges();
  });

  const panel = (selector: string): Element | null =>
    (fixture.nativeElement as HTMLElement).querySelector(selector);

  it('sin pedido no dibuja nada', () => {
    expect((fixture.nativeElement as HTMLElement).children.length).toBe(0);
  });

  it.each([
    ['app-nuevo-turno-panel', () => flujo.nuevoTurno({ origen: 'AGENDA' })],
    ['app-programacion-multiple-panel', () => flujo.programacionMultiple({ origen: 'PLAN' })],
    ['app-detalle-de-turno-panel', () => flujo.verTurno(7)],
    ['app-lista-de-espera-panel', () => flujo.listaDeEspera({ origen: 'LISTA_DE_ESPERA' })],
    ['app-bloqueo-de-agenda-panel', () => flujo.bloqueoDeAgenda({ origen: 'AGENDA' })],
  ] as const)('%s responde a su pedido, y el botón de cerrar lo saca', async (selector, pedir) => {
    pedir();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(panel(selector)).not.toBeNull();

    (panel('.panel-lateral__cerrar') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(flujo.solicitud()).toBeNull();
    expect(panel(selector)).toBeNull();
  });

  it('cada pedido recrea el panel: no arrastra el estado del anterior', async () => {
    flujo.verTurno(7);
    await fixture.whenStable();
    fixture.detectChanges();
    const primero = panel('app-detalle-de-turno-panel');

    flujo.verTurno(8);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(panel('app-detalle-de-turno-panel')).not.toBeNull();
    expect(panel('app-detalle-de-turno-panel')).not.toBe(primero);
  });
});
