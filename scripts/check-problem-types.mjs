/**
 * Verifica que todo `problemType` que el frontend nombra exista en el contrato.
 *
 * ## Por que existe este gate
 *
 * El frontend ramifica por `problemType` y nunca por `detail` (AGENT.md 8). Esa decision es
 * correcta, pero deja un agujero que **ninguna de las dos suites tapa**:
 *
 * - Los unitarios usan `HttpTestingController`: el `flush(...)` devuelve **lo que el test le
 *   dicta**. Un test puede afirmar que la pantalla reacciona a `server-error` aunque el backend
 *   no emita jamas ese valor.
 * - Los E2E de agenda sintetizan la respuesta con `route.fulfill` a traves del helper
 *   `problema(status, tipo, ...)` de `e2e/support/agenda-simulada.ts`, cuyo parametro `tipo` es
 *   un `string` suelto. El propio archivo lo declara en su cabecera: si el backend renombra
 *   `slot-completo`, **la suite sigue en verde y la pantalla queda rota**.
 *
 * El codigo de produccion si esta protegido: `AkineProblemType` se deriva del enum `ProblemType`
 * del cliente generado, asi que un `case 'inventado'` dentro de un `switch (error.problemType)`
 * no compila. Lo que no esta protegido es **todo literal que no pasa por ese tipo**: fixtures de
 * test, mocks de E2E y cualquier URI armada a mano. Ahi es donde este gate mira.
 *
 * Y `api:check` no alcanza: compara el **numero de version** declarado contra el del contrato,
 * no el **contenido** del catalogo.
 *
 * ## Que hace
 *
 * 1. Extrae el catalogo cerrado `ProblemType` de `../appKine-api/openapi/akine-api.yaml`.
 * 2. Recolecta los literales que usa el frontend, por las tres formas en que los expresa hoy.
 * 3. **Falla** si el frontend nombra uno que el contrato no declara.
 * 4. **Informa sin fallar** los que el contrato declara y el frontend todavia no maneja: es
 *    cobertura pendiente, no un defecto.
 *
 * Se ejecuta en CI y localmente con: npm run api:check
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const raizRepo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rutaContrato = resolve(raizRepo, '..', 'appKine-api', 'openapi', 'akine-api.yaml');

/**
 * Literales que el frontend usa **a proposito** sin que el contrato los declare.
 *
 * Cada entrada necesita justificacion. No es una valvula de escape para un literal que quedo
 * viejo: para eso se arregla el literal.
 */
const EXCEPCIONES = new Map([
  [
    'algo-que-todavia-no-existe',
    'Fixture negativo deliberado de error.interceptor.spec.ts: comprueba que un `type` que el ' +
      'catalogo no conoce devuelve null en vez del segmento crudo. Tiene que NO estar declarado.',
  ],
  [
    'algo-que-este-cliente-no-conoce',
    'Mismo caso en bloque-errors.spec.ts: comprueba que un tipo desconocido cae en la rama ' +
      'generica mostrando el detail del backend. Tiene que NO estar declarado.',
  ],
  [
    'not-implemented',
    'Centinela interno del harness de E2E (agenda-simulada.ts): un endpoint sin stub responde ' +
      '501 para romper el test en vez de devolver algo plausible. No lo emite el backend.',
  ],
]);

function fallar(mensaje) {
  console.error(`\n[problems:check] ${mensaje}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// 1. El catalogo que publica el contrato
// ---------------------------------------------------------------------------------------------

if (!existsSync(rutaContrato)) {
  fallar(
    `No se encontro el contrato en ${rutaContrato}.\n` +
      'El repo appKine-api debe estar clonado como hermano de este, y en la misma rama.',
  );
}

// El YAML se commitea con CRLF. Normalizar antes de aplicar anclas multilinea.
const contrato = readFileSync(rutaContrato, 'utf8').split('\r\n').join('\n');

// `ProblemType` es un schema de primer nivel bajo components.schemas (4 espacios). Su `enum`
// va a 6 y los items tambien. El corte es el siguiente schema hermano o una clave menos indentada.
const bloqueEnum = contrato.match(
  /^ {4}ProblemType:[\s\S]*?^ {6}enum:\n([\s\S]*?)(?=^ {4}\S|^ {2}\S)/m,
);
if (!bloqueEnum) {
  fallar(`No se pudo leer el enum ProblemType de ${rutaContrato}.`);
}

const declarados = new Set(
  [...bloqueEnum[1].matchAll(/^ {6}- https:\/\/akine\.app\/problems\/([a-z0-9-]+)\s*$/gm)].map(
    (m) => m[1],
  ),
);
if (declarados.size === 0) {
  fallar(
    'El enum ProblemType del contrato quedo vacio tras el parseo. Revisa el formato del YAML.',
  );
}

// ---------------------------------------------------------------------------------------------
// 2. Los literales que usa el frontend
// ---------------------------------------------------------------------------------------------

/** Archivos .ts de `src/` y `e2e/`, salteando el cliente generado (ahi vive el enum entero). */
function archivosTs(directorio, acumulado = []) {
  for (const entrada of readdirSync(directorio)) {
    if (entrada === 'node_modules' || entrada === 'generated') continue;
    const ruta = join(directorio, entrada);
    if (statSync(ruta).isDirectory()) archivosTs(ruta, acumulado);
    else if (entrada.endsWith('.ts')) acumulado.push(ruta);
  }
  return acumulado;
}

/**
 * Cuerpo de cada `switch` que ramifica sobre `problemType`, por balance de llaves.
 *
 * No sirve una regex hasta el proximo `}`: los `case` traen objetos y cierres propios. Y hace
 * falta acotar al bloque porque los `case` de otros `switch` del mismo archivo hablan de las
 * uniones internas del frontend (`CausaCobro`, `AccionSugerida`), que no son problemTypes.
 */
function cuerposDeSwitchSobreProblemType(texto) {
  const cuerpos = [];
  const apertura = /switch\s*\(\s*[\w.?]*\bproblemType\s*\)\s*\{/g;
  let encontrado;
  while ((encontrado = apertura.exec(texto))) {
    let i = encontrado.index + encontrado[0].length;
    let profundidad = 1;
    while (i < texto.length && profundidad > 0) {
      if (texto[i] === '{') profundidad++;
      else if (texto[i] === '}') profundidad--;
      i++;
    }
    cuerpos.push(texto.slice(encontrado.index, i));
  }
  return cuerpos;
}

/** slug -> archivos donde aparece. */
const usos = new Map();
function registrar(slug, archivo) {
  if (!usos.has(slug)) usos.set(slug, new Set());
  usos.get(slug).add(relative(raizRepo, archivo).split('\\').join('/'));
}

for (const archivo of [
  ...archivosTs(join(raizRepo, 'src')),
  ...archivosTs(join(raizRepo, 'e2e')),
]) {
  const texto = readFileSync(archivo, 'utf8');

  // (a) URI completa. Es la forma de los fixtures: `{ type: 'https://akine.app/problems/x' }`.
  //     No pasa por ningun tipo, asi que es la que de verdad puede mentir.
  for (const m of texto.matchAll(/akine\.app\/problems\/([a-z0-9-]+)/g)) registrar(m[1], archivo);

  // (b) Comparacion directa contra el catalogo. Hoy la protege el compilador via
  //     `AkineProblemType`; se incluye igual porque el cliente generado puede quedar viejo
  //     respecto del contrato commiteado sin que `api:check` lo note.
  for (const cuerpo of cuerposDeSwitchSobreProblemType(texto))
    for (const m of cuerpo.matchAll(/case\s*'([a-z0-9-]+)'/g)) registrar(m[1], archivo);
  for (const m of texto.matchAll(/\bproblemType\s*===\s*'([a-z0-9-]+)'/g)) registrar(m[1], archivo);

  // (c) Helper de E2E `problema(status, 'slug', ...)`, que arma la URI por interpolacion.
  //     Su parametro es un `string` suelto: sin esto, los mocks de `route.fulfill` no se miran.
  for (const m of texto.matchAll(/\bproblema\s*\(\s*\d{3}\s*,\s*'([a-z0-9-]+)'/g))
    registrar(m[1], archivo);
}

if (usos.size === 0) {
  fallar('No se encontro ningun literal de problemType en el frontend. El extractor se rompio.');
}

// ---------------------------------------------------------------------------------------------
// 3. El gate: usar algo que el contrato no declara
// ---------------------------------------------------------------------------------------------

const noDeclarados = [...usos.keys()]
  .filter((slug) => !declarados.has(slug) && !EXCEPCIONES.has(slug))
  .sort();

if (noDeclarados.length > 0) {
  const detalle = noDeclarados
    .map((slug) => `  - ${slug}\n${[...usos.get(slug)].map((f) => `      ${f}`).join('\n')}`)
    .join('\n');
  fallar(
    `El frontend nombra ${noDeclarados.length} problemType que el contrato no declara.\n\n` +
      `${detalle}\n\n` +
      'Cada uno es una de tres cosas:\n' +
      '  1. Un renombre del backend que el frontend no siguio -> corregir el literal.\n' +
      '  2. Un typo en un fixture -> el test verifica una rama que el backend nunca activa.\n' +
      '  3. Un caso deliberado de "tipo desconocido" -> agregar a EXCEPCIONES con justificacion.\n\n' +
      `Catalogo vigente: ${rutaContrato} (schema ProblemType).`,
  );
}

// ---------------------------------------------------------------------------------------------
// 4. El informe: declarados que el frontend todavia no maneja. No falla.
// ---------------------------------------------------------------------------------------------

const sinManejar = [...declarados].filter((slug) => !usos.has(slug)).sort();

console.log(
  `[problems:check] ${usos.size} problemType usados por el frontend, todos declarados en el contrato ` +
    `(catalogo de ${declarados.size}).`,
);
for (const [slug, motivo] of EXCEPCIONES) {
  if (usos.has(slug)) console.log(`[problems:check] excepcion declarada: ${slug} -- ${motivo}`);
}
if (sinManejar.length > 0) {
  console.log(
    `[problems:check] informativo: ${sinManejar.length} declarados que ninguna pantalla maneja todavia ` +
      '(cobertura pendiente, no un defecto):',
  );
  console.log(`  ${sinManejar.join(', ')}`);
}
