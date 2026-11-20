#!/usr/bin/env node
/**
 * Cruza las fichas del manual (appKine-api/src/main/resources/manual) con lo que vive en la web:
 *   - cada `![...](captura:ficha/nombre)` tiene su definición en e2e/manual/capturas/*.json, y al revés;
 *   - cada `:icono[x]:` existe en `TRAZOS` de app-icono o en los íconos propios del manual.
 * Falla con la lista de lo que no cierra. Se corre con `npm run manual:verificar`, que después
 * recorre las capturas sin escribirlas para ver que los elementos marcados sigan existiendo.
 *
 * Las fichas se buscan en `MANUAL_FICHAS_DIR` o, por defecto, en el repo hermano `../appKine-api`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dirFichas = resolve(
  process.env.MANUAL_FICHAS_DIR ?? join(raiz, '..', 'appKine-api', 'src', 'main', 'resources', 'manual'),
);
const dirCapturas = join(raiz, 'e2e', 'manual', 'capturas');

if (!existsSync(dirFichas)) {
  console.error(`No encuentro las fichas en ${dirFichas}. Definí MANUAL_FICHAS_DIR.`);
  process.exit(1);
}

const nombresDe = (archivo, patron) =>
  new Set([...readFileSync(join(raiz, archivo), 'utf8').matchAll(patron)].map((m) => m[1]));
const iconos = new Set([
  ...nombresDe('src/app/shared/components/icono/icono.ts', /^ {2}'?([a-z][a-z-]*)'?:/gm),
  ...nombresDe('src/app/shared/components/markdown-seguro/iconos-de-texto.ts', /^ {2}'?([a-z][a-z-]*)'?:/gm),
]);

const referidas = new Map();
const problemas = [];
for (const archivo of readdirSync(dirFichas).filter((a) => a.endsWith('.md'))) {
  const texto = readFileSync(join(dirFichas, archivo), 'utf8');
  for (const m of texto.matchAll(/\]\(captura:([a-z0-9-]+)\/([a-z0-9-]+)\)/g)) {
    referidas.set(`${m[1]}/${m[2]}`, archivo);
  }
  for (const m of texto.matchAll(/:icono\[([a-z-]+)\]:/g)) {
    if (!iconos.has(m[1])) problemas.push(`${archivo}: el ícono '${m[1]}' no existe`);
  }
}

const definidas = new Set();
for (const archivo of readdirSync(dirCapturas).filter((a) => a.endsWith('.json'))) {
  for (const c of JSON.parse(readFileSync(join(dirCapturas, archivo), 'utf8'))) {
    const clave = `${c.ficha}/${c.nombre}`;
    if (definidas.has(clave)) problemas.push(`${archivo}: captura repetida ${clave}`);
    definidas.add(clave);
    if (!c.ruta || !c.recorte || !Array.isArray(c.marcas)) problemas.push(`${archivo}: ${clave} incompleta`);
  }
}

for (const [clave, archivo] of referidas) {
  if (!definidas.has(clave)) problemas.push(`${archivo}: la captura ${clave} no tiene definición`);
}
for (const clave of definidas) {
  if (!referidas.has(clave)) problemas.push(`la captura ${clave} está definida y ninguna ficha la usa`);
}

if (problemas.length > 0) {
  console.error(`Manual: ${problemas.length} problema(s)\n  - ${problemas.join('\n  - ')}`);
  process.exit(1);
}
console.log(`Manual: ${referidas.size} capturas referidas y definidas; íconos al día.`);

if (process.argv.includes('--en-vivo')) {
  // Recorre las capturas contra la pila levantada, sin escribir imágenes.
  const corrida = spawnSync('npx', ['playwright', 'test', '--project=manual', '--workers=1'], {
    cwd: raiz,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, MANUAL_SOLO_VERIFICAR: '1' },
  });
  process.exit(corrida.status ?? 1);
}
