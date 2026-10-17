import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FocoAlMontar } from './foco-al-montar.directive';

@Component({
  imports: [FocoAlMontar],
  template: `
    <button id="abrir" type="button" (click)="abierto.set(true)">Abrir</button>
    @if (abierto()) {
      <section id="resultado" akineFocoAlMontar>Resultado</section>
    }
    @if (panel()) {
      <section id="panel" [akineFocoAlMontar]="'campo'">
        <button type="button" disabled>Deshabilitado</button>
        <input id="primero" />
      </section>
    }
    @if (vacio()) {
      <section id="vacio" tabindex="0" [akineFocoAlMontar]="'campo'">Sin controles</section>
    }
  `,
})
class Anfitrion {
  readonly abierto = signal(false);
  readonly panel = signal(false);
  readonly vacio = signal(false);
}

/**
 * La directiva de foco de AKINE-09.02. Se prueba a donde queda el foco, que es lo unico que hace:
 * al aparecer, en el bloque o en su primer control habilitado; al desaparecer, de vuelta en quien
 * lo abrio si quedo huerfano, y en ningun otro lado si la pantalla ya lo movio.
 */
describe('FocoAlMontar', () => {
  function montar() {
    const fixture = TestBed.createComponent(Anfitrion);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  }

  const porId = (id: string) => document.getElementById(id) as HTMLElement;
  const unTick = () => new Promise((resolve) => setTimeout(resolve));

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('enfoca el bloque que aparece, haciendolo enfocable sin sumarlo al orden del Tab', async () => {
    const fixture = montar();
    porId('abrir').focus();

    fixture.componentInstance.abierto.set(true);
    await fixture.whenStable();

    expect(document.activeElement).toBe(porId('resultado'));
    expect(porId('resultado').getAttribute('tabindex')).toBe('-1');
  });

  it('con "campo" enfoca el primer control habilitado de adentro', async () => {
    const fixture = montar();
    fixture.componentInstance.panel.set(true);
    await fixture.whenStable();

    expect(document.activeElement).toBe(porId('primero'));
  });

  it('con "campo" y sin controles, enfoca el bloque y respeta su tabindex', async () => {
    const fixture = montar();
    fixture.componentInstance.vacio.set(true);
    await fixture.whenStable();

    expect(document.activeElement).toBe(porId('vacio'));
    expect(porId('vacio').getAttribute('tabindex')).toBe('0');
  });

  it('al desaparecer devuelve el foco huerfano a quien lo tenia cuando aparecio', async () => {
    const fixture = montar();
    porId('abrir').focus();
    fixture.componentInstance.abierto.set(true);
    await fixture.whenStable();

    fixture.componentInstance.abierto.set(false);
    await fixture.whenStable();
    await unTick();

    expect(document.activeElement).toBe(porId('abrir'));
  });

  it('si la pantalla ya movio el foco, no se lo pisa', async () => {
    const fixture = montar();
    porId('abrir').focus();
    fixture.componentInstance.panel.set(true);
    await fixture.whenStable();

    fixture.componentInstance.abierto.set(true);
    await fixture.whenStable();
    fixture.componentInstance.panel.set(false);
    await fixture.whenStable();
    await unTick();

    expect(document.activeElement).toBe(porId('resultado'));
  });
});
