import { Result } from 'axe-core';

import {
  REGLAS_SIN_VEREDICTO_EN_JSDOM,
  TIMEOUT_AXE,
  auditar,
  esperarSinViolaciones,
  reglasSinVeredictoNoDeclaradas,
} from './axe';

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

  /**
   * El tercer cajon de axe.
   *
   * <p>Ademas de `violations` y `passes`, axe devuelve `incomplete`: "no pude comprobarlo". El
   * arnes lo pedia en `resultTypes` desde AKINE-01.02 y nadie lo leyo nunca, asi que cuarenta
   * auditorias venian pasando en verde con el contraste sin medir. Estos tres casos son el
   * guard que impide que eso vuelva a ocurrir en silencio, con cualquier regla.
   */
  describe('reglas sin veredicto', () => {
    /** Un `incomplete` sintetico: fabricar uno real en jsdom no seria reproducible. */
    function indecisa(id: string): Result {
      return {
        id,
        impact: null,
        tags: [],
        description: `regla ${id}`,
        help: `axe no pudo decidir ${id}`,
        helpUrl: '',
        nodes: [{ target: ['body'] } as unknown as Result['nodes'][number]],
      };
    }

    /**
     * Fija el contenido exacto del mapa, que es lo que lo vuelve una decision y no un tramite:
     * tolerar una regla nueva obliga a pasar por este test y a escribir el porque.
     */
    it('declara una sola regla tolerada, y dice donde se mide de verdad', () => {
      expect([...REGLAS_SIN_VEREDICTO_EN_JSDOM.keys()]).toEqual(['color-contrast']);
      expect(REGLAS_SIN_VEREDICTO_EN_JSDOM.get('color-contrast')).toContain(
        'e2e/contraste.spec.ts',
      );
    });

    it('deja pasar la regla declarada', () => {
      expect(reglasSinVeredictoNoDeclaradas([indecisa('color-contrast')])).toEqual([]);
    });

    it('delata cualquier otra regla que axe no haya podido decidir', () => {
      expect(
        reglasSinVeredictoNoDeclaradas([indecisa('color-contrast'), indecisa('aria-hidden-focus')]),
      ).toHaveLength(1);
    });

    /**
     * El censo vivo. Hoy `color-contrast` es la unica regla que jsdom no puede decidir sobre las
     * cinco etiquetas exigidas —medido sobre los 110 archivos de spec—. Si una version futura de
     * axe suma otra, esto lo dice aca en vez de repartir el fallo por cuarenta specs ajenos.
     */
    it(
      'hoy ninguna regla fuera de la declarada se queda sin veredicto',
      async () => {
        const contenedor = conHtml(
          '<p style="color: #767676; background: #fff">Texto sobre fondo claro</p>' +
            '<label for="c">Email</label><input id="c" type="email" />',
        );

        const resultado = await auditar(contenedor);

        expect(reglasSinVeredictoNoDeclaradas(resultado.incomplete)).toEqual([]);
      },
      TIMEOUT_AXE,
    );
  });
});
