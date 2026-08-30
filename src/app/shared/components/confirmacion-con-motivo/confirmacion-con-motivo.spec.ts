import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ConfirmacionConMotivo } from './confirmacion-con-motivo';

/**
 * Spec de la confirmacion con motivo.
 *
 * <p>Cubre <b>una sola cosa</b>, y es la que no tiene sintoma visible cuando esta mal: si el
 * motivo se exige donde no corresponde, el boton de confirmar no emite nada y la accion entera
 * se vuelve inejecutable desde la pantalla. Paso exactamente eso con la activacion del perfil de
 * paciente (RF-M07-008), que el contrato declara con motivo opcional: el panel se abria, se
 * llenaba y el boton no hacia nada.
 *
 * <p>Las dos direcciones importan y por eso estan las dos. El default tiene que seguir siendo
 * <b>obligatorio</b>: las cuatro pantallas de baja que usan este componente dependen de eso y
 * ninguna de sus specs lo afirma, asi que si el default se invirtiera, una baja saldria sin
 * justificacion escrita y ningun test protestaria.
 */
@Component({
  imports: [ConfirmacionConMotivo],
  template: `
    <akine-confirmacion-con-motivo
      idCampo="prueba"
      titulo="Confirmar la accion"
      [motivoObligatorio]="obligatorio()"
      (confirmado)="emitidos.push($event)"
    />
  `,
})
class Anfitrion {
  readonly obligatorio = signal(true);
  readonly emitidos: string[] = [];
}

describe('ConfirmacionConMotivo', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Anfitrion] }).compileComponents();
  });

  it('por defecto no confirma sin motivo, y dice por que', async () => {
    const fixture = await montar();

    enviar(fixture);

    expect(fixture.componentInstance.emitidos).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'El motivo es obligatorio',
    );
  });

  it('con el motivo declarado opcional confirma con el campo vacio', async () => {
    const fixture = await montar();
    fixture.componentInstance.obligatorio.set(false);
    fixture.detectChanges();

    enviar(fixture);

    expect(fixture.componentInstance.emitidos).toEqual(['']);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      'El motivo es obligatorio',
    );
  });

  async function montar(): Promise<ComponentFixture<Anfitrion>> {
    const fixture = TestBed.createComponent(Anfitrion);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function enviar(fixture: ComponentFixture<Anfitrion>): void {
    const formulario = (fixture.nativeElement as HTMLElement).querySelector(
      'form',
    ) as HTMLFormElement;
    formulario.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }
});
