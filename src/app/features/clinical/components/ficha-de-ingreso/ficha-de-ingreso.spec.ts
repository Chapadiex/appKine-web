import { TestBed } from '@angular/core/testing';

import { FichaDeIngresoRequest } from '../../../../api/generated/model/ficha-de-ingreso-request';
import { FichaDeIngresoResponse } from '../../../../api/generated/model/ficha-de-ingreso-response';
import { FichaDeIngreso } from './ficha-de-ingreso';

const FICHA = { version: 2, pesoKg: 73.5, alturaCm: 175 } as FichaDeIngresoResponse;

describe('FichaDeIngreso', () => {
  it('dos cambios en el mismo instante salen uno detrás del otro, no juntos con la misma versión', async () => {
    const fixture = TestBed.createComponent(FichaDeIngreso);
    fixture.componentRef.setInput('ficha', FICHA);
    fixture.componentRef.setInput('guardando', false);
    await fixture.whenStable();
    const emitidos: FichaDeIngresoRequest[] = [];
    fixture.componentInstance.guardar.subscribe((ficha) => emitidos.push(ficha));
    const raiz = fixture.nativeElement as HTMLElement;

    // Salir de la altura y elegir la actividad antes de que la página avise que está guardando.
    const altura = raiz.querySelector<HTMLInputElement>('#ficha-altura')!;
    altura.value = '176';
    altura.dispatchEvent(new Event('input'));
    altura.dispatchEvent(new Event('blur'));
    raiz.querySelector<HTMLInputElement>('app-segmentado input[value="OCASIONAL"]')!.click();
    expect(emitidos.length).toBe(1);

    // La página guarda y devuelve la versión nueva: recién ahí sale lo que quedó en cola.
    fixture.componentRef.setInput('guardando', true);
    await fixture.whenStable();
    fixture.componentRef.setInput('ficha', { ...FICHA, version: 3, alturaCm: 176 });
    fixture.componentRef.setInput('guardando', false);
    await fixture.whenStable();

    expect(emitidos.length).toBe(2);
    expect(emitidos[1].version).toBe(3);
    expect(emitidos[1].actividad).toBe('OCASIONAL');
  });
});
