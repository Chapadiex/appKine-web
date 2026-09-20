/**
 * Verifica que el contraste de color siga midiendose en algun lado.
 *
 * ## Por que existe este gate
 *
 * Las 40 auditorias de axe del repositorio corren bajo jsdom, que no calcula layout. Ahi la regla
 * `color-contrast` no puede decidir y termina en `incomplete`. Una suite que solo mira
 * `violations` queda en verde **sin haber medido nada**, y eso es exactamente lo que este
 * repositorio hizo durante veinte etapas: el `CLAUDE.md` del workspace lo declaraba como hueco
 * abierto —"el contraste de color no esta verificado en ninguna parte"— y nadie lo saldaba.
 *
 * El arnes de jsdom ahora **tolera** ese `incomplete`, y lo tolera con una justificacion escrita
 * que dice donde SI se mide: `e2e/contraste.spec.ts`, en Chromium, con los dos temas. Esa
 * justificacion es una promesa, y una promesa que nadie chequea se vuelve mentira sola. Borrar
 * el spec de contraste, o desconectarlo de `package.json`, o dejarlo corriendo en un solo tema,
 * no romperia ningun test: dejaria las 40 auditorias en verde declarando un contraste que volvio
 * a no medirse. **Esto es lo que impide ese regreso silencioso.**
 *
 * No mide contraste —eso lo hace el navegador—: comprueba que la medicion siga cableada.
 *
 * ## Que exige
 *
 * 1. Que exista `e2e/contraste.spec.ts`.
 * 2. Que `playwright.config.ts` declare un proyecto por tema, claro y oscuro, cada uno con su
 *    `colorScheme`: un contraste que pasa en claro puede fallar en oscuro.
 * 3. Que `package.json` exponga `a11y:contraste` corriendo **los dos** proyectos.
 * 4. Que el arnes de jsdom no tolere mas `incomplete` que el de `color-contrast`.
 *
 * Se encadena en `npm run test:ci`, detras del gate de cobertura: la suite de jsdom es la que se
 * beneficia de la excusa, asi que es la que tiene que pagar por sostenerla.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const raizRepo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SPEC_DE_CONTRASTE = 'e2e/contraste.spec.ts';
const ARNES_JSDOM = 'src/app/core/testing/axe.ts';
const PROYECTOS = ['contraste-claro', 'contraste-oscuro'];

const fallas = [];

function leer(rutaRelativa) {
  const ruta = join(raizRepo, rutaRelativa);
  return existsSync(ruta) ? readFileSync(ruta, 'utf8') : null;
}

// 1. El spec que mide -------------------------------------------------------------------------

if (leer(SPEC_DE_CONTRASTE) === null) {
  fallas.push(
    `No existe ${SPEC_DE_CONTRASTE}. Es el UNICO lugar del repositorio donde el contraste se ` +
      'mide con layout real; sin el, el `incomplete` que el arnes de jsdom tolera deja de tener ' +
      'donde cubrirse y las auditorias vuelven a pasar en verde sin medir nada.',
  );
}

// 2. Los dos temas ----------------------------------------------------------------------------

const configPlaywright = leer('playwright.config.ts') ?? '';
for (const proyecto of PROYECTOS) {
  if (!configPlaywright.includes(`name: '${proyecto}'`)) {
    fallas.push(
      `playwright.config.ts no declara el proyecto \`${proyecto}\`. El contraste se audita en ` +
        'los dos temas: el modo oscuro no es una inversion simetrica del claro y un par que ' +
        'pasa en uno puede fallar en el otro.',
    );
  }
}
for (const tema of ['light', 'dark']) {
  if (!configPlaywright.includes(`colorScheme: '${tema}'`)) {
    fallas.push(
      `playwright.config.ts no fija \`colorScheme: '${tema}'\` en ningun proyecto. Sin eso el ` +
        'tema lo decide el sistema operativo del runner, que es justo el dato que no puede ' +
        'quedar al azar.',
    );
  }
}

// 3. El script que lo corre --------------------------------------------------------------------

const paquete = JSON.parse(leer('package.json') ?? '{}');
const comando = paquete.scripts?.['a11y:contraste'];

if (typeof comando !== 'string') {
  fallas.push(
    'package.json no expone el script `a11y:contraste`. Un spec que nadie corre no es un gate.',
  );
} else {
  for (const proyecto of PROYECTOS) {
    if (!comando.includes(proyecto)) {
      fallas.push(
        `El script \`a11y:contraste\` no corre el proyecto \`${proyecto}\`. Auditar un solo tema ` +
          'deja el otro sin medir y el reporte no lo dice.',
      );
    }
  }
}

// 4. El arnes de jsdom no puede tolerar mas que el contraste ------------------------------------

const arnes = leer(ARNES_JSDOM) ?? '';
const bloque = arnes.match(/REGLAS_SIN_VEREDICTO_EN_JSDOM[^=]*=\s*new Map\(\[([\s\S]*?)\]\);/);

if (bloque === null) {
  fallas.push(
    `No se encontro REGLAS_SIN_VEREDICTO_EN_JSDOM en ${ARNES_JSDOM}. Es la lista de reglas cuyo ` +
      '`incomplete` el arnes tolera: sin ella no hay forma de saber que se esta dando por ' +
      'verificado sin verificar.',
  );
} else {
  const toleradas = [...bloque[1].matchAll(/^\s*\[\s*'([a-z0-9-]+)'/gm)].map((m) => m[1]);
  const inesperadas = toleradas.filter((regla) => regla !== 'color-contrast');

  if (inesperadas.length > 0) {
    fallas.push(
      `El arnes de jsdom tolera reglas sin veredicto que este gate no conoce: ` +
        `${inesperadas.join(', ')}. Cada una es una regla que las auditorias dan por buena sin ` +
        'haberla podido comprobar. Si la incorporacion es deliberada, se actualiza este gate ' +
        'diciendo donde se mide esa regla de verdad.',
    );
  }
}

// ----------------------------------------------------------------------------------------------

if (fallas.length > 0) {
  console.error('\n[contraste:check] El contraste dejo de estar medido:\n');
  for (const falla of fallas) {
    console.error(`  - ${falla}\n`);
  }
  process.exit(1);
}

console.log(
  `[contraste:check] El contraste se mide en ${SPEC_DE_CONTRASTE}, en modo claro y oscuro ` +
    '(`npm run a11y:contraste`). El arnes de jsdom solo tolera el `incomplete` de color-contrast.',
);
