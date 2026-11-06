import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { HorarioSemanal } from './horario-semanal';
import { crearFranjasForm, franjasDelFormulario } from '../../utils/franjas-semanales';

@Component({
  imports: [HorarioSemanal],
  template: `<app-horario-semanal [franjas]="franjas" idBase="prueba" />`,
})
class Anfitrion {
  readonly franjas = crearFranjasForm();
}

/**
 * Spec del horario semanal (alta de sede, A-8).
 *
 * <p>Se prueba lo que el formulario que viaja no delata solo: que un modelo cargue exactamente
 * las franjas que su rotulo promete, que la lista de horas que el navegador ofrece incluya la
 * medianoche, y que la tercera franja de un dia entre y salga sin tocar las otras dos.
 */
describe('HorarioSemanal', () => {
  async function montar() {
    const fixture = TestBed.createComponent(Anfitrion);
    await fixture.whenStable();
    const raiz: HTMLElement = fixture.nativeElement;
    const pulsar = async (texto: string) => {
      const boton = [...raiz.querySelectorAll<HTMLButtonElement>('button')].find((candidato) =>
        candidato.textContent?.includes(texto),
      );
      expect(boton, `no hay boton "${texto}"`).toBeDefined();
      boton!.click();
      await fixture.whenStable();
    };
    return { fixture, raiz, pulsar, franjas: fixture.componentInstance.franjas };
  }

  it('"Lunes a sábado" carga seis franjas, con el sábado de 09:00 a 13:00', async () => {
    const { raiz, pulsar, franjas } = await montar();
    await pulsar('Lunes a sábado');

    const valores = franjasDelFormulario(franjas);
    expect(valores.length).toBe(6);
    expect(valores.map((franja) => franja.diaSemana)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(valores[5]).toEqual({ diaSemana: 6, horaDesde: '09:00', horaHasta: '13:00' });
    expect(valores[0]).toEqual({ diaSemana: 1, horaDesde: '09:00', horaHasta: '18:00' });
    // El modelo aplicado queda marcado como elegido.
    const marcado = raiz.querySelector('.semana__modelo[aria-pressed="true"]');
    expect(marcado?.textContent?.trim()).toBe('Lunes a sábado');
  });

  it('las horas son desplegables de cuartos: abre hasta 23:45 y cierra hasta 24:00', async () => {
    const { raiz, pulsar } = await montar();
    await pulsar('Lunes a viernes');

    const horas = raiz.querySelectorAll<HTMLSelectElement>('select.semana__hora');
    expect(horas.length).toBe(10);
    expect(raiz.querySelector('input.semana__hora')).toBeNull();
    const valores = (campo: HTMLSelectElement) => [...campo.options].map((opcion) => opcion.value);
    const abre = valores(raiz.querySelector<HTMLSelectElement>('#prueba-desde-0')!);
    const cierra = valores(raiz.querySelector<HTMLSelectElement>('#prueba-hasta-0')!);
    expect(abre.slice(0, 2)).toEqual(['', '00:00']);
    expect(abre.at(-1)).toBe('23:45');
    expect(cierra.slice(0, 2)).toEqual(['', '00:15']);
    expect(cierra.at(-1)).toBe('24:00');
    expect(horas[0].value).toBe('09:00');
  });

  it('"+ Otra franja" suma una tercera franja vacia al dia y "Quitar" la saca', async () => {
    const { fixture, raiz, pulsar, franjas } = await montar();
    // El lunes abre solo (09 a 18); el corte lo parte en dos.
    raiz.querySelector<HTMLInputElement>('#prueba-abre-1')!.click();
    await fixture.whenStable();
    await pulsar('Corte al mediodía');
    expect(franjasDelFormulario(franjas).length).toBe(2);
    // Con una sola franja no se ofrecia; con dos, si.
    expect(raiz.textContent).toContain('Otra franja');
    expect(raiz.textContent).not.toContain('Quitar');

    await pulsar('Otra franja');
    const conTres = franjasDelFormulario(franjas);
    expect(conTres.length).toBe(3);
    expect(conTres[2]).toEqual({ diaSemana: 1, horaDesde: '', horaHasta: '' });
    // Tope por dia: ya no se ofrece una cuarta, y cada franja puede quitarse.
    expect(raiz.textContent).not.toContain('Otra franja');
    const quitar = raiz.querySelectorAll<HTMLButtonElement>('.semana__quitar');
    expect(quitar.length).toBe(3);
    expect(quitar[2].textContent?.replace(/\s+/g, ' ').trim()).toBe('Quitar la franja 3 del Lunes');

    quitar[2].click();
    await fixture.whenStable();
    expect(franjasDelFormulario(franjas)).toEqual([
      { diaSemana: 1, horaDesde: '09:00', horaHasta: '13:00' },
      { diaSemana: 1, horaDesde: '14:00', horaHasta: '18:00' },
    ]);
  });
});
