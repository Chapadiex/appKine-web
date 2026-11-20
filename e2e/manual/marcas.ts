import { Page, expect } from '@playwright/test';
import { Marca } from './definicion';

const CAPA = 'akine-marcas-del-manual';

/**
 * Dibuja las marcas encima de la pantalla antes de capturarla: un recuadro alrededor de cada
 * elemento y un círculo con el número del paso. Quedan quemadas en la imagen. Falla si un selector
 * no da exactamente un elemento visible: así `manual:verificar` avisa que la ficha quedó vieja.
 *
 * <p>Colores fijos y no tokens a propósito: la capa no es parte de la aplicación y tiene que verse
 * igual sobre cualquier tema. Naranja de alto contraste sobre fondos claros (WCAG 1.4.11, 3:1).
 */
export async function marcar(page: Page, marcas: readonly Marca[]): Promise<void> {
  const cajas: {
    x: number;
    y: number;
    ancho: number;
    alto: number;
    numero?: number;
    zona: boolean;
  }[] = [];
  for (const marca of marcas) {
    const elemento = page.locator(marca.selector);
    await expect(elemento, `la marca ${marca.numero ?? ''} (${marca.selector})`).toHaveCount(1);
    await elemento.scrollIntoViewIfNeeded();
    const caja = await elemento.boundingBox();
    expect(caja, `la marca ${marca.selector} no está visible`).not.toBeNull();
    cajas.push({
      x: caja!.x,
      y: caja!.y,
      ancho: caja!.width,
      alto: caja!.height,
      numero: marca.numero,
      zona: marca.forma === 'zona',
    });
  }
  await page.evaluate(
    ({ id, cajas: lista }) => {
      document.getElementById(id)?.remove();
      const capa = document.createElement('div');
      capa.id = id;
      capa.setAttribute('aria-hidden', 'true');
      capa.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
      for (const c of lista) {
        const recuadro = document.createElement('div');
        recuadro.style.cssText =
          `position:fixed;left:${c.x - 4}px;top:${c.y - 4}px;width:${c.ancho + 8}px;height:${c.alto + 8}px;` +
          `border:3px ${c.zona ? 'dashed' : 'solid'} #d9480f;border-radius:8px;` +
          'box-shadow:0 0 0 3px rgba(255,255,255,.85)';
        capa.appendChild(recuadro);
        if (c.numero !== undefined) {
          const numero = document.createElement('div');
          numero.textContent = String(c.numero);
          numero.style.cssText =
            `position:fixed;left:${c.x + c.ancho - 6}px;top:${c.y - 16}px;width:26px;height:26px;` +
            'border-radius:50%;background:#d9480f;color:#fff;border:2px solid #fff;' +
            'font:700 14px/22px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4)';
          capa.appendChild(numero);
        }
      }
      // Un dialog modal vive en la capa superior del navegador y tapa todo lo demás: la capa de marcas
      // va adentro del dialog abierto, si hay uno.
      const dialogo = document.querySelector('dialog[open]');
      (dialogo ?? document.body).appendChild(capa);
    },
    { id: CAPA, cajas },
  );
}
