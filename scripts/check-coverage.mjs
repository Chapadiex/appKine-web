/**
 * Gate de cobertura del frontend (AKINE-00.02).
 *
 * El builder `@angular/build:unit-test` de Angular 21 acepta configurar que se mide
 * (`coverageExclude`), pero NO expone umbrales: publica el reporte y sale con exito
 * aunque la cobertura sea del 5 %. Sin este gate, el numero seria decorativo.
 *
 * Lee `coverage/coverage-summary.json` y falla si algun contador queda por debajo del piso.
 *
 * El plan exige >=80 % en codigo nuevo y >=90 % en modulos criticos. Los umbrales son un
 * PISO, no una meta: el baseline mide ~98 %.
 *
 * Uso: npm run test:ci   (ya lo encadena)
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const UMBRALES = {
  statements: 80,
  branches: 80,
  functions: 80,
  lines: 80,
};

const raizRepo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dirCobertura = join(raizRepo, 'coverage');

/**
 * El builder de Angular anida el reporte bajo el nombre del proyecto
 * (`coverage/akine-web/`), pero vitest a secas lo deja en `coverage/`. Se buscan ambos
 * para que el gate no dependa de ese detalle.
 */
function ubicarResumen() {
  const directo = join(dirCobertura, 'coverage-summary.json');
  if (existsSync(directo)) {
    return directo;
  }

  if (!existsSync(dirCobertura)) {
    return null;
  }

  for (const entrada of readdirSync(dirCobertura, { withFileTypes: true })) {
    if (!entrada.isDirectory()) {
      continue;
    }
    const anidado = join(dirCobertura, entrada.name, 'coverage-summary.json');
    if (existsSync(anidado)) {
      return anidado;
    }
  }

  return null;
}

const rutaResumen = ubicarResumen();

if (rutaResumen === null) {
  console.error(
    `\n[coverage] No se encontro coverage-summary.json bajo ${dirCobertura}.\n` +
      'Corre los tests con cobertura: npm run test:ci\n' +
      'El reporter json-summary se configura en angular.json > test > coverageReporters.\n',
  );
  process.exit(1);
}

const total = JSON.parse(readFileSync(rutaResumen, 'utf8')).total;

const fallos = [];
for (const [contador, minimo] of Object.entries(UMBRALES)) {
  const medido = total[contador]?.pct;

  if (typeof medido !== 'number') {
    fallos.push(`  ${contador.padEnd(11)} no reportado por el runner`);
    continue;
  }

  const estado = medido >= minimo ? 'OK  ' : 'BAJO';
  const linea = `  ${estado} ${contador.padEnd(11)} ${medido.toFixed(2)}%  (piso ${minimo}%)`;

  console.log(linea);
  if (medido < minimo) {
    fallos.push(linea);
  }
}

if (fallos.length > 0) {
  console.error(
    '\n[coverage] Cobertura por debajo del piso exigido:\n' +
      fallos.join('\n') +
      '\n\nAgrega tests para el codigo nuevo. Bajar el umbral requiere una decision\n' +
      'documentada en el plan de implementacion, no un cambio en este archivo.\n',
  );
  process.exit(1);
}

console.log('[coverage] Cobertura sobre el piso exigido.');
