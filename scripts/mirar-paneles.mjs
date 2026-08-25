/**
 * Segunda parte de la inspeccion visual: los paneles desplegados dentro de la tabla y el
 * resultado de la consulta de disponibilidad.
 *
 * Es lo que no se ve en la carga inicial de cada pantalla y es justamente donde el layout
 * puede romperse: un formulario de siete campos metido en una celda con `colspan`.
 *
 * Uso: node scripts/mirar-paneles.mjs   (con `npm start` corriendo)
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import { instalarApiSimulada } from './api-simulada.mjs';

const BASE = 'http://localhost:4200';
const SALIDA = 'test-results/mirar-espacios';

const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
await instalarApiSimulada(contexto);

const pagina = await contexto.newPage();
pagina.on('console', (m) => {
  if (m.type() === 'error') console.log(`  [consola] ${m.text()}`);
});

mkdirSync(SALIDA, { recursive: true });

async function medir() {
  return pagina.evaluate(() => {
    const tabla = document.querySelector('.tabla-scroll');
    const activo = document.activeElement;
    return {
      bodyDesborda: document.documentElement.scrollWidth > window.innerWidth + 1,
      tablaDesborda: tabla === null ? null : tabla.scrollWidth > tabla.clientWidth + 1,
      foco: activo === null ? null : activo.id || activo.tagName,
    };
  });
}

for (const [nombre, ancho, alto] of [
  ['edicion-desktop', 1280, 900],
  ['edicion-tablet', 768, 1024],
]) {
  await pagina.setViewportSize({ width: ancho, height: alto });
  await pagina.goto(`${BASE}/espacios`, { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(600);
  await pagina.getByRole('button', { name: 'Editar' }).first().click();
  await pagina.waitForTimeout(400);
  await pagina.screenshot({ path: `${SALIDA}/${nombre}.png`, fullPage: true });
  console.log(`${nombre} (${ancho}x${alto}) -> ${JSON.stringify(await medir())}`);
}

await pagina.setViewportSize({ width: 1280, height: 900 });
await pagina.goto(`${BASE}/espacios`, { waitUntil: 'networkidle' });
await pagina.waitForTimeout(600);
await pagina.getByRole('button', { name: 'Dar de baja' }).first().click();
await pagina.waitForTimeout(400);
await pagina.screenshot({ path: `${SALIDA}/baja-desktop.png`, fullPage: true });
console.log(`baja-desktop -> ${JSON.stringify(await medir())}`);

await pagina.goto(`${BASE}/espacios/disponibilidad`, { waitUntil: 'networkidle' });
await pagina.waitForTimeout(600);
await pagina.getByRole('button', { name: 'Ver que espacios hay' }).click();
await pagina.waitForTimeout(700);
await pagina.screenshot({ path: `${SALIDA}/disponibilidad-resultado.png`, fullPage: true });
console.log(`disponibilidad-resultado -> ${JSON.stringify(await medir())}`);

await navegador.close();
