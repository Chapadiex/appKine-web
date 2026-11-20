import { ManualStore } from './manual.store';

describe('ManualStore', () => {
  it('abre y cierra con alternar, y abrir vuelve a seguir la pantalla', () => {
    const manual = new ManualStore();

    manual.verFicha('egresos');
    expect(manual.abierto()).toBe(true);
    expect(manual.fichaPedida()).toBe('egresos');

    manual.alternar();
    expect(manual.abierto()).toBe(false);

    manual.alternar();
    expect(manual.abierto()).toBe(true);
    expect(manual.fichaPedida()).toBeNull();
  });

  it('deja de seguir la ficha pedida sin cerrar el panel', () => {
    const manual = new ManualStore();
    manual.verFicha('caja-diaria');

    manual.seguirPantalla();

    expect(manual.fichaPedida()).toBeNull();
    expect(manual.abierto()).toBe(true);
  });
});
