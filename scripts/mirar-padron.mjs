/**
 * Inspeccion visual del padron de personas (AKINE-03.01), con la API simulada.
 *
 * NO es un test ni un E2E: no afirma nada. Levanta un navegador real contra el dev server,
 * responde `/api` con datos sinteticos y saca capturas para MIRAR el layout, que es lo unico que
 * los tests unitarios no ven -jsdom no calcula ancho ni desborde-. Mismo criterio, y mismo
 * alcance, que `mirar-espacios.mjs`.
 *
 * <p><b>Lo que si mide, ademas de la captura:</b> si el body desborda a lo ancho -la navegacion
 * se va de la pantalla- y si la tabla desborda su contenedor -hay columnas escondidas-. La tabla
 * del padron tiene seis columnas y la ultima es la de acciones: si queda detras del scroll, el
 * boton de activar perfil no existe para el usuario.
 *
 * Uso: node scripts/mirar-padron.mjs   (con `npm start` corriendo)
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import { instalarApiSimulada } from './api-simulada.mjs';

const BASE = 'http://localhost:4200';
const SALIDA = 'test-results/mirar-padron';

const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
await instalarApiSimulada(contexto);

const pagina = await contexto.newPage();
pagina.on('console', (mensaje) => {
  if (mensaje.type() === 'error') {
    console.log(`  [consola] ${mensaje.text()}`);
  }
});

mkdirSync(SALIDA, { recursive: true });

async function mirar(nombre, ruta, ancho, alto) {
  await pagina.setViewportSize({ width: ancho, height: alto });
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(600);

  const archivo = `${SALIDA}/${nombre}.png`;
  await pagina.screenshot({ path: archivo, fullPage: true });

  const medidas = await pagina.evaluate(() => {
    const tabla = document.querySelector('table');
    return {
      bodyDesborda: document.documentElement.scrollWidth > window.innerWidth + 1,
      tablaDesborda: tabla === null ? false : tabla.scrollWidth > tabla.clientWidth + 1,
      filas: document.querySelectorAll('tbody tr').length,
      titulo: document.querySelector('h1')?.textContent?.trim() ?? '(sin h1)',
    };
  });

  console.log(`${nombre} (${ancho}x${alto}) -> ${archivo}`);
  console.log(`  ${JSON.stringify(medidas)}`);
}

await mirar('padron-escritorio', '/pacientes', 1280, 900);
await mirar('padron-angosto', '/pacientes', 900, 900);

// El panel de alta abierto: es el formulario mas largo de la pantalla y el que puede empujar el
// aviso de duplicados fuera de la vista.
await pagina.setViewportSize({ width: 1280, height: 900 });
await pagina.goto(`${BASE}/pacientes`, { waitUntil: 'networkidle' });
await pagina.getByRole('button', { name: 'Dar de alta una persona' }).click();
await pagina.waitForTimeout(300);
await pagina.screenshot({ path: `${SALIDA}/padron-alta.png`, fullPage: true });
console.log(`padron-alta -> ${SALIDA}/padron-alta.png`);

await navegador.close();
