/**
 * Build de produccion de AKINE con los chunks optimizados, y gate de la carga inicial
 * (AKINE-LCP).
 *
 *   npm run build              (lo usan el CI y el Dockerfile)
 *   npm run build -- --configuration development
 *
 * Por que existe: G-10 midio el LCP movil (slow 4G de Lighthouse) entre 2,85 y 4,10 s, y el
 * perfil mostro que el bundle no pesa -90 KB comprimidos- pero llega en SIETE niveles de
 * imports en serie. esbuild parte el codigo inicial en 18 chunks que se importan entre si, y
 * Angular solo emite `modulepreload` para 10, los de menor profundidad: el chunk de 172 KB con
 * el framework se descubre recien despues de bajar y evaluar el `main`. Con 150 ms de latencia
 * cada nivel es una ida y vuelta.
 *
 * `NG_BUILD_OPTIMIZE_CHUNKS=1` le pide al builder que pase el resultado por su optimizador de
 * chunks (rollup), que funde el codigo inicial en un solo `main`. Es la unica forma de
 * activarlo: no tiene opcion en `angular.json`. Por eso el build pasa por aca y no por
 * `ng build` a secas.
 *
 * Desde Angular 22 ese optimizador corre por defecto sobre rolldown, que NO funde el codigo
 * inicial: deja el `main` mas ocho chunks importados en forma estatica (medido el 14/10/2026,
 * 371,69 kB en 10 archivos contra 359,56 kB en uno solo con Angular 21). `NG_BUILD_CHUNKS_ROLLDOWN=0`
 * vuelve al optimizador de rollup, el mismo que usaba Angular 21, y por eso `rollup` es una
 * dependencia de desarrollo explicita: el builder la pide y no la instala. Si una version futura
 * de Angular quita ese camino, el gate de abajo lo dice.
 *
 * Despues del build de produccion verifica que el resultado siga siendo UNA sola ida y vuelta
 * de JavaScript inicial: si una version de Angular renombra la variable o deja de fundir los
 * chunks, el build falla en vez de devolver la cascada en silencio. El tamano lo cuidan los
 * `budgets` de `angular.json`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raizRepo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ng = require.resolve('@angular/cli/bin/ng.js');
const argumentos = process.argv.slice(2);

const build = spawnSync(process.execPath, [ng, 'build', ...argumentos], {
  cwd: raizRepo,
  stdio: 'inherit',
  env: {
    ...process.env,
    NG_BUILD_OPTIMIZE_CHUNKS: process.env.NG_BUILD_OPTIMIZE_CHUNKS ?? '1',
    NG_BUILD_CHUNKS_ROLLDOWN: process.env.NG_BUILD_CHUNKS_ROLLDOWN ?? '0',
  },
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const deDesarrollo = argumentos.some((a) => /development/.test(a));
if (deDesarrollo) {
  process.exit(0);
}

const navegador = join(raizRepo, 'dist', 'akine-web', 'browser');
const indexHtml = join(navegador, 'index.html');
if (!existsSync(indexHtml)) {
  console.error(`No existe ${indexHtml}: no se puede verificar la carga inicial.`);
  process.exit(1);
}

const html = readFileSync(indexHtml, 'utf8');
const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
const precargas = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map(
  (m) => m[1],
);

const fallas = [];
if (scripts.length !== 1) {
  fallas.push(`el index.html carga ${scripts.length} scripts, se esperaba uno solo (el main)`);
}
if (precargas.length > 0) {
  fallas.push(
    `el index.html precarga ${precargas.length} chunks: el codigo inicial volvio a partirse`,
  );
}
for (const script of scripts) {
  const codigo = readFileSync(join(navegador, script), 'utf8');
  const estaticos = [...codigo.matchAll(/(?:from|import)\s*["'`]\.\/[\w.-]+\.js["'`]/g)];
  if (estaticos.length > 0) {
    fallas.push(
      `${script} importa ${estaticos.length} chunks de forma estatica: cada nivel es una ida ` +
        'y vuelta mas antes de arrancar',
    );
  }
}

if (fallas.length > 0) {
  console.error('\nGate de carga inicial (AKINE-LCP):');
  for (const falla of fallas) {
    console.error(`  - ${falla}`);
  }
  console.error(
    '\nSe esperaba el JavaScript inicial en un solo archivo. Ver el encabezado de ' +
      'scripts/build-produccion.mjs.',
  );
  process.exit(1);
}

console.log(`Gate de carga inicial: ${scripts[0]} sin imports estaticos, sin modulepreload.`);

// --- Manifiesto de precarga (AKINE-LCP, segunda vuelta) -------------------------------------
//
// Cada pantalla es un chunk perezoso que importa de forma estatica otros chunks compartidos. El
// navegador los descubre recien al analizar el de la pantalla: una ida y vuelta mas, en serie.
// Aca se calcula, para cada chunk que el `main` importa de forma dinamica (los `loadComponent`),
// el cierre de sus imports estaticos sin el `main`, y se escribe en el `index.html` como bloque de
// datos. `core/services/precarga-de-modulos.ts` lo lee y agrega un `modulepreload` por cada
// dependencia en cuanto el router empieza a bajar la pantalla.
//
// Es `type="application/json"`: el navegador no lo ejecuta y la CSP (`script-src`) no lo alcanza.
// `index.html` se sirve sin cache, asi que el manifiesto siempre es el del despliegue vigente.
const importsEstaticos = (archivo) =>
  [
    ...readFileSync(join(navegador, archivo), 'utf8').matchAll(
      /(?:from|import)\s*["'`]\.\/([\w.-]+\.js)["'`]/g,
    ),
  ].map((m) => m[1]);
const codigoMain = readFileSync(join(navegador, scripts[0]), 'utf8');
const pantallas = new Set(
  [...codigoMain.matchAll(/import\(\s*["'`]\.\/(chunk-[\w-]+\.js)["'`]\s*\)/g)].map((m) => m[1]),
);
const manifiesto = {};
for (const pantalla of pantallas) {
  const cierre = new Set();
  const pendientes = importsEstaticos(pantalla);
  while (pendientes.length > 0) {
    const dependencia = pendientes.pop();
    if (dependencia === scripts[0] || dependencia === pantalla || cierre.has(dependencia)) {
      continue;
    }
    cierre.add(dependencia);
    pendientes.push(...importsEstaticos(dependencia));
  }
  if (cierre.size > 0) {
    manifiesto[pantalla] = [...cierre].sort();
  }
}
if (pantallas.size === 0) {
  console.error(
    `\nManifiesto de precarga: ${scripts[0]} no tiene ningun import() de chunk. Si el builder ` +
      'cambio la forma de los imports dinamicos, la precarga dejaria de funcionar en silencio.',
  );
  process.exit(1);
}
const bloque = `<script type="application/json" id="akine-precarga">${JSON.stringify(manifiesto)}</script>`;
if (!html.includes('</body>')) {
  console.error(`${indexHtml} no tiene </body>: no se puede escribir el manifiesto de precarga.`);
  process.exit(1);
}
writeFileSync(
  indexHtml,
  html.replace('</body>', () => `${bloque}</body>`),
);
console.log(
  `Manifiesto de precarga: ${Object.keys(manifiesto).length} de ${pantallas.size} pantallas ` +
    'con dependencias compartidas.',
);

// --- Precompresion (AKINE-LCP, segunda vuelta) -----------------------------------------------
//
// nginx comprimia cada respuesta al vuelo con gzip nivel 5, y la imagen `nginx-unprivileged` no
// trae el modulo de Brotli. Se comprime UNA vez aca, al maximo, y nginx sirve el archivo ya
// comprimido (`docker/nginx/default.conf.template`): `.br` si el navegador acepta Brotli, `.gz`
// si no (`gzip_static`), y el original como ultimo recurso.
//
// Solo JavaScript y CSS: son los unicos archivos con hash en el nombre que viajan en la carga
// inicial, y nginx sirve el `.br` sin el modulo SOLO para esas dos extensiones (ver la plantilla).
// TODOS llevan sus dos variantes, sin minimo de tamano: la plantilla anuncia `Content-Encoding: br`
// cuando sirve el `.br`, y un archivo sin variante no puede caer en esa rama.
const precomprimibles = readdirSync(navegador).filter((archivo) => /\.(js|css)$/.test(archivo));
let crudo = 0;
let conGzip = 0;
let conBrotli = 0;
for (const archivo of precomprimibles) {
  const ruta = join(navegador, archivo);
  const contenido = readFileSync(ruta);
  const gz = gzipSync(contenido, { level: zlibConstants.Z_BEST_COMPRESSION });
  const br = brotliCompressSync(contenido, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: contenido.length,
    },
  });
  writeFileSync(`${ruta}.gz`, gz);
  writeFileSync(`${ruta}.br`, br);
  crudo += contenido.length;
  conGzip += gz.length;
  conBrotli += br.length;
}
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
console.log(
  `Precompresion: ${precomprimibles.length} archivos JS/CSS, ${kb(crudo)} -> gzip ${kb(conGzip)}, ` +
    `brotli ${kb(conBrotli)}.`,
);
