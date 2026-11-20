import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Page } from '@playwright/test';
import { expect, ingresar, navegar, test } from '../support/agenda-real';
import { CapturaDelManual, leerCapturas } from './definicion';
import { marcar } from './marcas';

/**
 * Genera las capturas marcadas del manual sobre el centro sembrado por `agenda-setup` (datos
 * sintéticos). `npm run manual:capturas` las escribe en `public/manual/<ficha>/<nombre>.png`;
 * `npm run manual:verificar` recorre lo mismo sin escribir y falla si un elemento marcado ya no
 * existe. `MANUAL_FICHA=caja-diaria` limita a una ficha.
 */
const SOLO_VERIFICAR = process.env['MANUAL_SOLO_VERIFICAR'] === '1';
const FICHA = process.env['MANUAL_FICHA'];
const MARGEN = 20;

const capturas = leerCapturas().filter((c) => !FICHA || c.ficha === FICHA);

// Una por vez (el login comparte el límite por IP), pero una captura rota no corta las demás.
test.describe.configure({ mode: 'default' });

for (const captura of capturas) {
  test(`${captura.ficha}/${captura.nombre}`, async ({ page, centro }) => {
    test.skip(captura.omitir !== undefined, captura.omitir);
    await ingresar(page, centro);
    const ruta = captura.ruta
      .replace(':organizationId', String(centro.organizationId))
      .replace(':consultorioId', String(centro.consultorioId));
    await navegar(page, ruta);
    await page.waitForLoadState('networkidle');
    await prepararEstado(page, captura);

    const recorte = page.locator(captura.recorte).first();
    await expect(recorte, `el recorte ${captura.recorte}`).toBeVisible();
    await marcar(page, captura.marcas);
    if (SOLO_VERIFICAR) {
      return;
    }
    const destino = join(
      __dirname,
      '..',
      '..',
      'public',
      'manual',
      captura.ficha,
      `${captura.nombre}.png`,
    );
    mkdirSync(dirname(destino), { recursive: true });
    await page.screenshot({
      path: destino,
      clip: await zonaConMarcas(page, captura),
      animations: 'disabled',
    });
  });
}

async function prepararEstado(page: Page, captura: CapturaDelManual): Promise<void> {
  for (const paso of captura.pasos ?? []) {
    const elemento = page.locator(paso.selector).first();
    if (paso.opcional && !(await elemento.isVisible())) {
      continue;
    }
    if (paso.accion === 'click') {
      await elemento.click();
    } else if (paso.accion === 'escribir') {
      await elemento.fill(paso.texto);
    } else {
      await expect(elemento).toBeVisible();
    }
  }
  await page.waitForLoadState('networkidle');
}

/** El recorte más las marcas, con margen: un número que cae al borde no queda cortado. */
async function zonaConMarcas(
  page: Page,
  captura: CapturaDelManual,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const cajas = [await page.locator(captura.recorte).first().boundingBox()];
  for (const marca of captura.marcas) {
    cajas.push(await page.locator(marca.selector).boundingBox());
  }
  const validas = cajas.filter((c): c is NonNullable<typeof c> => c !== null);
  const vista = page.viewportSize() ?? { width: 1280, height: 800 };
  const x = Math.max(0, Math.min(...validas.map((c) => c.x)) - MARGEN);
  const y = Math.max(0, Math.min(...validas.map((c) => c.y)) - MARGEN - 16);
  const derecha = Math.min(
    vista.width,
    Math.max(...validas.map((c) => c.x + c.width)) + MARGEN + 16,
  );
  const abajo = Math.min(vista.height, Math.max(...validas.map((c) => c.y + c.height)) + MARGEN);
  return { x, y, width: derecha - x, height: abajo - y };
}
