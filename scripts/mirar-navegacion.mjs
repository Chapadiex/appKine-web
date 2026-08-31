/**
 * Inspeccion visual de la navegacion principal, con la API simulada.
 *
 * NO es un test ni un E2E: no afirma nada. Levanta un navegador real contra el dev server,
 * responde `/api` con datos sinteticos y mide lo unico que jsdom no puede -ancho, desborde y
 * orden real del foco-. Mismo criterio y mismo alcance que `mirar-espacios.mjs`.
 *
 * <p><b>Lo que mira, y por que.</b> La navegacion es lo primero de la cabecera en toda pantalla:
 * si desborda a lo ancho en tablet, la seccion de la derecha deja de existir para el usuario; si
 * el primer Tab no cae en el skip link, el teclado tiene que recorrer siete enlaces antes de
 * llegar al contenido en cada pagina. Ninguna de las dos cosas la ve un spec de Vitest.
 *
 * <p>La API simulada no devuelve `colaborador:read`, asi que "Horarios" NO tiene que aparecer:
 * es el filtrado por permiso visto desde afuera.
 *
 * Uso: node scripts/mirar-navegacion.mjs   (con `npm start` corriendo)
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import { instalarApiSimulada } from './api-simulada.mjs';

const BASE = 'http://localhost:4200';
const SALIDA = 'test-results/mirar-navegacion';

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
    const nav = document.querySelector('nav[aria-label]');
    const enlaces = Array.from(document.querySelectorAll('.nav__enlace'));
    return {
      url: location.pathname + location.search,
      bodyDesborda: document.documentElement.scrollWidth > window.innerWidth + 1,
      navEtiqueta: nav?.getAttribute('aria-label') ?? null,
      secciones: enlaces.map((enlace) => enlace.textContent.trim()),
      actual:
        document.querySelector('[aria-current="page"]')?.textContent?.trim() ?? null,
      contexto: document.querySelector('.contexto__valor')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      titulo: document.querySelector('h1')?.textContent?.trim() ?? null,
    };
  });

  console.log(`${nombre} (${ancho}x${alto}) -> ${archivo}`);
  console.log(`   ${JSON.stringify(medidas)}`);
}

console.log('--- La raiz ya no es el baseline tecnico ---');
await mirar('raiz-desktop', '/', 1280, 900);

console.log('--- La seccion actual cambia con la ruta ---');
await mirar('pacientes-desktop', '/pacientes', 1280, 900);
await mirar('organizacion-desktop', '/organizacion', 1280, 900);

console.log('--- Angosto: la barra no puede desbordar ---');
await mirar('pacientes-tablet', '/pacientes', 768, 1024);
await mirar('pacientes-movil', '/pacientes', 390, 844);

console.log('--- El skip link sigue siendo el primer Tab, con el menu montado ---');
await pagina.setViewportSize({ width: 1280, height: 900 });
await pagina.goto(`${BASE}/pacientes`, { waitUntil: 'networkidle' });
await pagina.locator('body').focus();
await pagina.keyboard.press('Tab');
console.log(
  `   primer Tab -> ${JSON.stringify(
    await pagina.evaluate(() => ({
      texto: document.activeElement?.textContent?.trim(),
      clase: document.activeElement?.className,
    })),
  )}`,
);

// Tabular por toda la navegacion: ningun enlace puede quedar inalcanzable.
const recorrido = [];
for (let i = 0; i < 10; i += 1) {
  await pagina.keyboard.press('Tab');
  recorrido.push(await pagina.evaluate(() => document.activeElement?.textContent?.trim()));
}
console.log(`   siguientes Tab -> ${JSON.stringify(recorrido)}`);

await navegador.close();
