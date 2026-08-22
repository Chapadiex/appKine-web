/**
 * Verifica que el cliente generado corresponda al contrato que declara el frontend.
 *
 * El backend es propietario de `akine-api.yaml`. Este repo declara en
 * `src/environments/environment.ts` que version consume. Si alguien regenera el cliente
 * desde un contrato mas nuevo y olvida actualizar la declaracion --o al reves-- el
 * frontend queda mintiendo sobre lo que habla.
 *
 * Se ejecuta en CI y localmente con: npm run api:check
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const raizRepo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rutaContrato = resolve(raizRepo, '..', 'appKine-api', 'openapi', 'akine-api.yaml');
const rutaEntorno = join(raizRepo, 'src', 'environments', 'environment.ts');

function fallar(mensaje) {
  console.error(`\n[api:check] ${mensaje}\n`);
  process.exit(1);
}

if (!existsSync(rutaContrato)) {
  fallar(
    `No se encontro el contrato en ${rutaContrato}.\n` +
      'El repo appKine-api debe estar clonado como hermano de este, y en la misma rama.',
  );
}

const contrato = readFileSync(rutaContrato, 'utf8');

// La version vive bajo info:, indentada. El `servers:` relativo no aporta otra clave
// `version:` de primer nivel, asi que la primera coincidencia indentada es la correcta.
const versionContrato = contrato.match(/^\s{2}version:\s*["']?([^"'\s]+)/m)?.[1];
if (!versionContrato) {
  fallar(`No se pudo leer info.version de ${rutaContrato}.`);
}

const entorno = readFileSync(rutaEntorno, 'utf8');
const versionDeclarada = entorno.match(/contractVersion:\s*['"]([^'"]+)['"]/)?.[1];
if (!versionDeclarada) {
  fallar(`No se pudo leer contractVersion de ${rutaEntorno}.`);
}

if (versionContrato !== versionDeclarada) {
  fallar(
    `Desalineacion de contrato.\n` +
      `  Contrato publicado por el backend: ${versionContrato}\n` +
      `  Version declarada por el frontend: ${versionDeclarada}\n\n` +
      'Regenera el cliente y actualiza environment.ts:\n' +
      '  npm run api:generate\n' +
      '  # luego ajusta contractVersion en src/environments/environment*.ts',
  );
}

console.log(`[api:check] Contrato alineado: ${versionContrato}`);
