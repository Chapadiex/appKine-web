import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Page } from '@playwright/test';
import { ingresarPorPantalla } from '../support/akine';
import { expect, ingresar, navegar, test } from '../support/agenda-real';
import { Centro, deAUnLogin, esperaDel429 } from '../support/sembrado';
import { Marcadores, asegurarDatosDelManual } from './datos-del-manual';
import { CapturaDelManual, Marca, leerCapturas } from './definicion';
import { marcar } from './marcas';

/**
 * Genera las capturas marcadas del manual sobre el centro sembrado por `agenda-setup` (datos
 * sintéticos). `npm run manual:capturas` las escribe en `public/manual/<ficha>/<nombre>.png`;
 * `npm run manual:verificar` recorre lo mismo sin escribir y falla si un elemento marcado ya no
 * existe. `MANUAL_FICHA=caja-diaria` limita a una ficha.
 *
 * <p>Los datos de ejemplo que las capturas necesitan (paciente, turnos, convenio, clases...) los
 * siembra `datos-del-manual.ts` por la API, una vez y reusados entre corridas.
 */
const SOLO_VERIFICAR = process.env['MANUAL_SOLO_VERIFICAR'] === '1';
const FICHA = process.env['MANUAL_FICHA'];
const MARGEN = 20;

const capturas = leerCapturas().filter((c) => !FICHA || c.ficha === FICHA);

// Una por vez (el login comparte el límite por IP), pero una captura rota no corta las demás.
test.describe.configure({ mode: 'default' });

let marcadores: Marcadores = {};

test.beforeAll(async ({ centro }) => {
  // La primera corrida siembra todo; las siguientes sólo releen y rehacen lo vencido.
  test.setTimeout(300_000);
  if (capturas.some((c) => c.omitir === undefined)) {
    marcadores = {
      organizationId: String(centro.organizationId),
      consultorioId: String(centro.consultorioId),
      ...(await asegurarDatosDelManual(centro)),
    };
  }
});

for (const original of capturas) {
  test(`${original.ficha}/${original.nombre}`, async ({ page, centro }) => {
    test.skip(original.omitir !== undefined, original.omitir);
    test.setTimeout(90_000);
    const captura = resolver(original, marcadores);
    if (captura.cuenta === 'profesional') {
      await ingresarComoProfesional(page, centro);
    } else {
      await ingresar(page, centro);
    }
    await navegar(page, captura.ruta);
    await page.waitForLoadState('networkidle');
    await prepararEstado(page, captura);

    const recorte = page.locator(captura.recorte).first();
    await expect(recorte, `el recorte ${captura.recorte}`).toBeVisible();
    if (captura.ficha !== 'asistente-de-datos') {
      // El botón flotante del asistente no es parte de la pantalla que se explica y tapa la captura.
      await page.addStyleTag({ content: 'app-asistente-flotante { display: none !important; }' });
    }
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

/** Reemplaza `:marcador` por su valor en la ruta, los selectores, los textos y los valores. */
function resolver(captura: CapturaDelManual, valores: Marcadores): CapturaDelManual {
  const r = (texto: string): string =>
    texto.replace(/:([a-zA-Z]+)/g, (todo, clave: string) => valores[clave] ?? todo);
  return {
    ...captura,
    ruta: r(captura.ruta),
    recorte: r(captura.recorte),
    marcas: captura.marcas.map((m): Marca => ({ ...m, selector: r(m.selector) })),
    pasos: captura.pasos?.map((p) => {
      const paso = { ...p, selector: r(p.selector) };
      if (paso.accion === 'escribir') {
        return { ...paso, texto: r(paso.texto) };
      }
      if (paso.accion === 'seleccionar' && paso.valor !== undefined) {
        return { ...paso, valor: r(paso.valor) };
      }
      return paso;
    }),
  };
}

/**
 * Ingresa por pantalla como la profesional del centro. Su cuenta tiene dos lugares de trabajo (su
 * consultorio propio y el centro), así que el selector de contexto pregunta: se elige el centro.
 */
async function ingresarComoProfesional(page: Page, centro: Centro): Promise<void> {
  for (let intento = 1; ; intento++) {
    const espera = await deAUnLogin(async () => {
      const login = page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/auth/login'),
      );
      await ingresarPorPantalla(page, centro.emailProfesional);
      const respuesta = await login;
      if (respuesta.status() === 429 && intento < 3) {
        return esperaDel429(respuesta);
      }
      await expect(page).not.toHaveURL(/\/auth\//, { timeout: 15_000 });
      return 0;
    });
    if (espera === 0) {
      break;
    }
    await page.waitForTimeout(espera * 1_000);
  }
  if (/\/seleccionar-contexto/.test(page.url())) {
    await page.locator('button.opcion', { hasText: centro.nombreCentro }).first().click();
  }
  await expect(page).not.toHaveURL(/\/(auth|seleccionar-contexto)/, { timeout: 15_000 });
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
    } else if (paso.accion === 'seleccionar') {
      if (paso.valor !== undefined) {
        await expect(elemento.locator(`option[value="${paso.valor}"]`)).toBeAttached();
        await elemento.selectOption(paso.valor);
      } else {
        const indice = paso.indice ?? 1;
        await expect(elemento.locator('option').nth(indice)).toBeAttached();
        await elemento.selectOption({ index: indice });
      }
    } else if (paso.accion === 'tecla') {
      await elemento.press(paso.tecla);
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
