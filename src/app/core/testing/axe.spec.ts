import { TIMEOUT_AXE, auditar, esperarSinViolaciones } from './axe';

/**
 * Verifica la herramienta de auditoria, no una pantalla.
 *
 * <p>Un test de accesibilidad que nunca puede fallar es peor que no tenerlo: da por
 * verificado lo que no se verifico. Aca se planta una violacion evidente y se comprueba que
 * el arnes la ve y rompe el test; si alguien afloja las opciones de axe hasta volverlas
 * decorativas, esto se cae.
 */
describe('arnes de axe-core', () => {
  function conHtml(html: string): HTMLElement {
    const contenedor = document.createElement('div');
    contenedor.innerHTML = html;
    document.body.appendChild(contenedor);
    return contenedor;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it(
    'detecta un control sin etiqueta y una imagen sin texto alternativo',
    async () => {
      const contenedor = conHtml('<input type="text" /><img src="x.png" />');

      const resultado = await auditar(contenedor);

      expect(resultado.violations.map((violacion) => violacion.id).sort()).toEqual([
        'image-alt',
        'label',
      ]);
    },
    TIMEOUT_AXE,
  );

  it(
    'falla nombrando la regla y el nodo culpable, para no tener que reproducirlo a mano',
    async () => {
      const contenedor = conHtml('<input id="sin-etiqueta" type="text" />');

      await expect(esperarSinViolaciones(contenedor)).rejects.toThrow(/label/);
    },
    TIMEOUT_AXE,
  );

  it(
    'no protesta con un formulario bien etiquetado',
    async () => {
      const contenedor = conHtml('<label for="ok">Email</label><input id="ok" type="email" />');

      await esperarSinViolaciones(contenedor);
    },
    TIMEOUT_AXE,
  );
});
