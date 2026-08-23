import axe, { AxeResults, ElementContext, Result, RunOptions } from 'axe-core';

/**
 * Auditoria de accesibilidad con axe-core sobre el DOM que rinde un componente.
 *
 * <p><b>Por que existe.</b> Las pantallas de identidad y de organizacion se habian
 * verificado contando `label`s a mano y con las reglas de plantilla de ESLint. Ninguna de
 * las dos cosas mira el DOM renderizado: no ven un `aria-describedby` que apunta a un id
 * que no existe, un `role` sin nombre accesible ni un control sin etiqueta asociada. Esto
 * si, porque corre sobre el arbol real que produjo el `TestBed`.
 *
 * <p><b>Por que `axe-core` y no `@axe-core/playwright`.</b> Estos son tests de componente
 * en Vitest: no hay navegador ni pagina que auditar, solo el elemento del fixture. El
 * paquete de Playwright inyecta axe en una pagina real y aca no habria donde inyectarlo.
 *
 * <p><b>Se audita el elemento del componente, no el documento.</b> Las reglas que axe marca
 * como `pageLevel` -`region`, `landmark-one-main`, `html-has-lang`, `page-has-heading-one`-
 * hablan de la pagina completa, y una pagina completa es el shell (`app.html`) mas la
 * pantalla ruteada. Corriendolas contra una pantalla aislada solo producirian fallos de
 * montaje de test. axe las saltea sola cuando el contexto no es el documento entero.
 *
 * <p><b>Limitacion honesta: el contraste no se puede verificar aca.</b> jsdom no calcula
 * layout ni resuelve colores heredados, asi que `color-contrast` termina siempre en
 * `incomplete` -"axe no pudo decidir"-, nunca en `violations`. La regla se deja habilitada
 * igual para que el dia que estos tests corran en un browser real empiece a evaluar sola.
 * Mientras tanto el contraste se sostiene con los valores documentados en `auth.css` y
 * `organization.css`, y con la verificacion visual del QA manual.
 */

/** Etiquetas de reglas que se exigen: WCAG 2.1 AA completo mas las buenas practicas. */
const ETIQUETAS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

const OPCIONES: RunOptions = {
  runOnly: { type: 'tag', values: ETIQUETAS },
  resultTypes: ['violations', 'incomplete'],
};

/**
 * Timeout que hay que darle a cada `it` que audita con axe.
 *
 * <p>El default de Vitest son 5 s y no alcanzan: la <b>primera</b> corrida de axe dentro de
 * cada archivo de test paga el armado del motor sobre jsdom y tarda ~6 s medidos; las
 * siguientes bajan a ~0,5 s. Sin este margen el primer `it` de cada spec falla por timeout
 * y el segundo revienta con "Axe is already running", que es el mismo problema disfrazado.
 */
export const TIMEOUT_AXE = 20_000;

/** Resultado crudo de axe, por si un test necesita mirar algo puntual. */
export function auditar(elemento: ElementContext): Promise<AxeResults> {
  return axe.run(elemento, OPCIONES);
}

/**
 * Falla el test si axe encontro alguna violacion, mostrando cual y donde.
 *
 * <p>El mensaje incluye el selector del nodo culpable: un "hay 1 violacion" sin decir de
 * que elemento obliga a reproducir a mano lo que la herramienta ya sabe.
 */
export async function esperarSinViolaciones(elemento: ElementContext): Promise<void> {
  const resultado = await auditar(elemento);

  if (resultado.violations.length > 0) {
    throw new Error(
      `axe-core encontro violaciones de accesibilidad:\n${detallar(resultado.violations)}`,
    );
  }
}

function detallar(violaciones: Result[]): string {
  return violaciones
    .map((violacion) => {
      const nodos = violacion.nodes.map((nodo) => `      ${nodo.target.join(' ')}`).join('\n');
      return `  [${violacion.impact ?? 'sin impacto'}] ${violacion.id}: ${violacion.help}\n${nodos}`;
    })
    .join('\n');
}
