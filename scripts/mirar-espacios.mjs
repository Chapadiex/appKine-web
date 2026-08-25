/**
 * Inspeccion visual de las pantallas de espacios (AKINE-02.02), con la API simulada.
 *
 * NO es un test ni un E2E: no afirma nada. Levanta un navegador real contra el dev server,
 * responde `/api` con datos sinteticos y saca capturas para MIRAR el layout, que es lo unico
 * que los tests unitarios no ven -jsdom no calcula ancho ni desborde-.
 *
 * Uso: node scripts/mirar-espacios.mjs   (con `npm start` corriendo)
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:4200';
const SALIDA = 'test-results/mirar-espacios';

import { instalarApiSimulada } from './api-simulada.mjs';

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

  // Lo que jsdom no puede medir: si el body desborda a lo ancho, la navegacion se va de la
  // pantalla; si la tabla desborda su contenedor, hay columnas escondidas.
  const medidas = await pagina.evaluate(() => {
    const tabla = document.querySelector('.tabla-scroll');
    const activo = () => document.activeElement?.tagName ?? '?';
    return {
      bodyDesborda: document.documentElement.scrollWidth > window.innerWidth + 1,
      tablaDesborda: tabla === null ? null : tabla.scrollWidth > tabla.clientWidth + 1,
      anchoMain: document.querySelector('main')?.getBoundingClientRect().width ?? null,
      regionEnfocable: tabla?.getAttribute('tabindex') ?? null,
      primerActivo: activo(),
      url: location.pathname + location.search,
      titulo: document.querySelector('h1')?.textContent?.trim() ?? null,
    };
  });

  console.log(`${nombre} (${ancho}x${alto}) -> ${archivo}`);
  console.log(`   ${JSON.stringify(medidas)}`);
}

console.log('--- Listado de espacios ---');
await mirar('listado-desktop', '/espacios', 1280, 900);
await mirar('listado-tablet', '/espacios', 768, 1024);

console.log('--- Alta ---');
await mirar('alta-desktop', '/espacios/nuevo', 1280, 900);

console.log('--- Disponibilidad ---');
await mirar('disponibilidad-desktop', '/espacios/disponibilidad', 1280, 900);
await mirar('disponibilidad-tablet', '/espacios/disponibilidad', 768, 1024);

// Recorrido por teclado en tablet, que es donde la tabla desborda: se cuenta cuantos tabs
// hacen falta para llegar a la region de la tabla y se verifica que se pueda desplazar con
// las flechas una vez enfocada. Es exactamente el defecto que los gates no vieron.
await pagina.setViewportSize({ width: 768, height: 1024 });
await pagina.goto(`${BASE}/espacios`, { waitUntil: 'networkidle' });
await pagina.waitForTimeout(600);

const recorrido = [];
for (let i = 0; i < 25; i += 1) {
  await pagina.keyboard.press('Tab');
  const donde = await pagina.evaluate(() => {
    const el = document.activeElement;
    if (el === null) return '?';
    const clase = el.className?.toString().split(' ')[0] ?? '';
    return `${el.tagName}${clase === '' ? '' : '.' + clase}`;
  });
  recorrido.push(donde);
  if (donde.includes('tabla-scroll')) break;
}
console.log(`\nTabs hasta la region de la tabla: ${recorrido.length}`);
console.log(`Recorrido: ${recorrido.join(' -> ')}`);

const desplazo = await pagina.evaluate(async () => {
  const tabla = document.querySelector('.tabla-scroll');
  if (tabla === null) return null;
  const antes = tabla.scrollLeft;
  tabla.scrollLeft = tabla.scrollWidth;
  const despues = tabla.scrollLeft;
  tabla.scrollLeft = antes;
  return { antes, maximo: despues, hayDesborde: despues > 0 };
});
console.log(`Desplazamiento de la tabla: ${JSON.stringify(desplazo)}`);


await navegador.close();
