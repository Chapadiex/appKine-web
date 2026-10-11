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
 * Despues del build de produccion verifica que el resultado siga siendo UNA sola ida y vuelta
 * de JavaScript inicial: si una version de Angular renombra la variable o deja de fundir los
 * chunks, el build falla en vez de devolver la cascada en silencio. El tamano lo cuidan los
 * `budgets` de `angular.json`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
  env: { ...process.env, NG_BUILD_OPTIMIZE_CHUNKS: process.env.NG_BUILD_OPTIMIZE_CHUNKS ?? '1' },
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
