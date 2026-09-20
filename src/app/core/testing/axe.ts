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
 * <p><b>Lo que jsdom no puede decidir se declara, no se ignora.</b> axe tiene un tercer
 * cajon ademas de `violations` y `passes`: `incomplete`, que quiere decir "no pude
 * comprobarlo". Bajo jsdom `color-contrast` cae SIEMPRE ahi, porque no hay layout ni color
 * heredado que resolver. Durante veinte etapas este arnes pidio ese cajon en `resultTypes`
 * y <b>nunca lo miro</b>: las auditorias solo leian `violations`, asi que quedaban en verde
 * declarando un contraste que ninguna de ellas habia medido. Ver
 * {@link REGLAS_SIN_VEREDICTO_EN_JSDOM}.
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
 *
 * <p><b>Subido de 20 s a 35 s en AKINE-02.01.</b> El costo no es del `it` que falla sino de
 * la contencion entre workers: al sumar los specs de sedes, la suite completa paso de 31 a
 * 33 archivos y `register-page` —que no cambio en nada— empezo a superar los 20 s de forma
 * reproducible, mientras seguia pasando en ~16 s corrido solo. El numero tiene que cubrir el
 * arranque de axe multiplicado por la maquina mas cargada que corra la suite, no por la
 * medicion en frio de una sola.
 */
export const TIMEOUT_AXE = 35_000;

/**
 * Las unicas reglas cuyo `incomplete` este arnes tolera, con el motivo y donde SI se miden.
 *
 * <p><b>Para que existe.</b> Un `incomplete` es "axe no pudo comprobarlo", y leerlo como verde
 * es la forma mas cara de creerse cubierto. La lista es corta a proposito: mientras una regla no
 * este aca, su `incomplete` <b>rompe la auditoria</b> y obliga a decidir que se hace con ella en
 * vez de dejarla pasar veinte etapas sin que nadie se entere.
 *
 * <p><b>El censo esta medido, no estimado.</b> Se corrio la suite completa con el arnes
 * instrumentado para volcar todo `incomplete` que produjeran los 110 archivos de spec: 58
 * ocurrencias, <b>todas de la misma regla</b>. Ninguna otra de las cinco etiquetas exigidas
 * -`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `best-practice`- se queda sin veredicto bajo
 * jsdom. Si una version futura de axe agrega otra, esta lista la va a delatar en la primera
 * corrida.
 *
 * <p><b>Agregar una entrada es una decision, no un tramite.</b> `axe.spec.ts` afirma el
 * contenido exacto de este mapa: sumar una regla obliga a tocar ese test y a escribir ahi por
 * que, que es justamente la conversacion que hay que tener.
 */
export const REGLAS_SIN_VEREDICTO_EN_JSDOM: ReadonlyMap<string, string> = new Map([
  [
    'color-contrast',
    'jsdom no calcula layout ni resuelve el color heredado de un ancestro, asi que axe nunca ' +
      'puede decidir el contraste aca. NO significa que el contraste no se verifique: se mide ' +
      'en Chromium, con los dos temas, en `e2e/contraste.spec.ts` (`npm run a11y:contraste`), ' +
      'que es un gate propio del pipeline. Ese es el unico lugar del repositorio donde el ' +
      'contraste tiene un veredicto real.',
  ],
]);

/** Resultado crudo de axe, por si un test necesita mirar algo puntual. */
export function auditar(elemento: ElementContext): Promise<AxeResults> {
  return axe.run(elemento, OPCIONES);
}

/**
 * Las reglas que quedaron sin veredicto y que nadie declaro como tolerables.
 *
 * <p>Se expone aparte y pura para poder probarla con resultados sinteticos: fabricar en jsdom un
 * `incomplete` de una regla arbitraria no es reproducible, y un guard que solo se puede ejercitar
 * con suerte no es un guard.
 */
export function reglasSinVeredictoNoDeclaradas(incompletos: readonly Result[]): Result[] {
  return incompletos.filter((regla) => !REGLAS_SIN_VEREDICTO_EN_JSDOM.has(regla.id));
}

/**
 * Falla el test si axe encontro alguna violacion <b>o si se quedo sin veredicto</b> en una regla
 * que nadie declaro como indecidible en este entorno.
 *
 * <p>El mensaje incluye el selector del nodo culpable: un "hay 1 violacion" sin decir de
 * que elemento obliga a reproducir a mano lo que la herramienta ya sabe.
 *
 * <p>La segunda comprobacion es la que impide volver al estado anterior: antes, una regla que axe
 * no podia decidir desaparecia del resultado sin dejar rastro y la auditoria pasaba igual. Ahora
 * o esta en {@link REGLAS_SIN_VEREDICTO_EN_JSDOM} con su justificacion y el lugar donde SI se
 * mide, o rompe el test.
 */
export async function esperarSinViolaciones(elemento: ElementContext): Promise<void> {
  const resultado = await auditar(elemento);

  if (resultado.violations.length > 0) {
    throw new Error(
      `axe-core encontro violaciones de accesibilidad:\n${detallar(resultado.violations)}`,
    );
  }

  const indecisas = reglasSinVeredictoNoDeclaradas(resultado.incomplete);
  if (indecisas.length > 0) {
    throw new Error(
      'axe-core no pudo decidir estas reglas y ninguna esta declarada como indecidible bajo ' +
        `jsdom:\n${detallar(indecisas)}\n` +
        'Un "incomplete" NO es un "pass". O se mide en un entorno que si pueda decidirla -como ' +
        'hace `e2e/contraste.spec.ts` con el contraste-, o se agrega a ' +
        'REGLAS_SIN_VEREDICTO_EN_JSDOM diciendo por que y donde se cubre.',
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
