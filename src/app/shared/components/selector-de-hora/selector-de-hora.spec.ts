import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { SelectorDeHora } from './selector-de-hora';

@Component({
  imports: [SelectorDeHora, ReactiveFormsModule],
  template: `
    <app-selector-de-hora
      idCampo="hora"
      etiqueta="Hasta"
      [formControl]="hora"
      [intervalo]="intervalo"
      [hastaMedianoche]="true"
    />
  `,
})
class Anfitrion {
  readonly hora = new FormControl('', { nonNullable: true });
  intervalo: 15 | 30 = 30;
}

/**
 * Lo que el selector tiene que garantizar hacia el formulario: el valor es el string del contrato
 * —elegido de la grilla o escrito como hora exacta—, la medianoche se ofrece como `24:00`, y un
 * valor cargado que no esta en la grilla se muestra en el campo de hora exacta en vez de perderse.
 */
describe('SelectorDeHora', () => {
  it('ofrece la grilla de media hora con la medianoche al final y escribe el valor elegido', async () => {
    const fixture = TestBed.createComponent(Anfitrion);
    await fixture.whenStable();
    const raiz: HTMLElement = fixture.nativeElement;
    const lista = raiz.querySelector<HTMLSelectElement>('#hora');
    const valores = [...(lista?.options ?? [])].map((opcion) => opcion.value);

    // Vacio, 48 medias horas, 24:00 y "Otra hora".
    expect(valores.length).toBe(1 + 48 + 1 + 1);
    expect(valores).toContain('09:30');
    expect(valores).toContain('24:00');
    expect(raiz.querySelector('#hora-exacta')).toBeNull();

    lista!.value = '24:00';
    lista!.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(fixture.componentInstance.hora.value).toBe('24:00');
  });

  it('"Otra hora" destapa el campo exacto y lo escrito viaja tal cual al control', async () => {
    const fixture = TestBed.createComponent(Anfitrion);
    await fixture.whenStable();
    const raiz: HTMLElement = fixture.nativeElement;
    const lista = raiz.querySelector<HTMLSelectElement>('#hora')!;

    lista.value = 'otra';
    lista.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    const exacta = raiz.querySelector<HTMLInputElement>('#hora-exacta');
    expect(exacta).not.toBeNull();
    exacta!.value = '09:10';
    exacta!.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    // Lo escrito no se corrige ni se redondea: validar es del formulario.
    expect(fixture.componentInstance.hora.value).toBe('09:10');
  });

  it('un valor cargado fuera de la grilla se muestra como hora exacta, y uno de la grilla en la lista', async () => {
    const fixture = TestBed.createComponent(Anfitrion);
    fixture.componentInstance.hora.setValue('09:10');
    await fixture.whenStable();
    const raiz: HTMLElement = fixture.nativeElement;

    expect(raiz.querySelector<HTMLSelectElement>('#hora')?.value).toBe('otra');
    expect(raiz.querySelector<HTMLInputElement>('#hora-exacta')?.value).toBe('09:10');

    fixture.componentInstance.hora.setValue('09:00');
    await fixture.whenStable();
    expect(raiz.querySelector<HTMLSelectElement>('#hora')?.value).toBe('09:00');
    expect(raiz.querySelector('#hora-exacta')).toBeNull();
  });

  it('con la grilla de 15 minutos aparecen los cuartos de hora', async () => {
    const fixture = TestBed.createComponent(Anfitrion);
    fixture.componentInstance.intervalo = 15;
    await fixture.whenStable();
    const raiz: HTMLElement = fixture.nativeElement;
    const valores = [...(raiz.querySelector<HTMLSelectElement>('#hora')?.options ?? [])].map(
      (opcion) => opcion.value,
    );
    expect(valores).toContain('09:15');
    expect(valores.length).toBe(1 + 96 + 1 + 1);
  });
});
