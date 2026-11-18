import { TestBed } from '@angular/core/testing';

import { ESPERA_DE_CONFIRMACION_MS, NumeroConPasos } from './numero-con-pasos';

async function montar(opciones: { valor?: number | null; max?: number; decimales?: number } = {}) {
  const fixture = TestBed.createComponent(NumeroConPasos);
  fixture.componentRef.setInput('idCampo', 'peso');
  fixture.componentRef.setInput('etiqueta', 'Peso');
  fixture.componentRef.setInput('decimales', opciones.decimales ?? 1);
  if (opciones.max !== undefined) {
    fixture.componentRef.setInput('max', opciones.max);
  }
  fixture.componentInstance.valor.set(opciones.valor ?? null);
  await fixture.whenStable();
  const raiz = fixture.nativeElement as HTMLElement;
  const campo = raiz.querySelector('input')!;
  const [menos, mas] = [...raiz.querySelectorAll<HTMLButtonElement>('button')];
  const escribir = (texto: string): void => {
    campo.value = texto;
    campo.dispatchEvent(new Event('input'));
  };
  return { fixture, campo, menos, mas, escribir };
}

describe('NumeroConPasos', () => {
  it('coma y punto valen lo mismo', async () => {
    const { fixture, escribir } = await montar();
    escribir('72,5');
    expect(fixture.componentInstance.valor()).toBe(72.5);
    escribir('72.5');
    expect(fixture.componentInstance.valor()).toBe(72.5);
  });

  it('texto que no es número no cambia el valor y marca el campo', async () => {
    const { fixture, campo, escribir } = await montar({ valor: 70 });
    escribir('70 kg');
    await fixture.whenStable();
    expect(fixture.componentInstance.valor()).toBe(70);
    expect(campo.getAttribute('aria-invalid')).toBe('true');
  });

  it('vacío es null', async () => {
    const { fixture, escribir } = await montar({ valor: 70 });
    escribir('');
    expect(fixture.componentInstance.valor()).toBeNull();
  });

  it('+ se apaga en el máximo', async () => {
    const { mas } = await montar({ valor: 400, max: 400 });
    expect(mas.disabled).toBe(true);
  });

  it('una ráfaga de + confirma una sola vez con el valor final', async () => {
    // Se monta antes de congelar el reloj: `whenStable` espera timers reales.
    const { fixture, mas } = await montar({ valor: 70, decimales: 0 });
    vi.useFakeTimers();
    try {
      const confirmados: (number | null)[] = [];
      fixture.componentInstance.confirmado.subscribe((v) => confirmados.push(v));
      mas.click();
      mas.click();
      mas.click();
      vi.advanceTimersByTime(ESPERA_DE_CONFIRMACION_MS - 1);
      expect(confirmados).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(confirmados).toEqual([73]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('si el padre limpia el valor, el campo deja de mostrar lo escrito', async () => {
    const { fixture, campo, escribir } = await montar();
    escribir('45');
    await fixture.whenStable();
    fixture.componentInstance.valor.set(null);
    await fixture.whenStable();
    expect(campo.value).toBe('');
  });

  it('más decimales de los admitidos o por encima del máximo es inválido y no se emite', async () => {
    const { fixture, campo, escribir } = await montar({ valor: 170, max: 250, decimales: 0 });
    escribir('175,5');
    await fixture.whenStable();
    expect(fixture.componentInstance.valor()).toBe(170);
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    escribir('300');
    expect(fixture.componentInstance.valor()).toBe(170);
  });

  it('apoyar el dedo no cambia el valor; un scroll cancelado no se come el próximo paso', async () => {
    const { fixture, mas } = await montar({ valor: 70, decimales: 0 });
    mas.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }));
    expect(fixture.componentInstance.valor()).toBe(70);
    mas.dispatchEvent(new PointerEvent('pointercancel'));
    mas.click();
    expect(fixture.componentInstance.valor()).toBe(71);
  });

  it('sin valor, + arranca donde se pidió (el año actual) y no en el mínimo', async () => {
    const { fixture, mas } = await montar({ decimales: 0 });
    fixture.componentRef.setInput('min', 1900);
    fixture.componentRef.setInput('desdeVacio', 2026);
    await fixture.whenStable();
    mas.click();
    expect(fixture.componentInstance.valor()).toBe(2026);
  });
});
