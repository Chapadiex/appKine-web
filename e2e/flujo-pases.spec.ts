import { Page } from '@playwright/test';

import { nonce } from './support/akine';
import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { ClaseDePack, claseDePackConUnaInscripta } from './support/sembrado-pases';

/**
 * E2E de pases y productos de pack (F9, M29, AKINE-08.06) contra el backend REAL.
 *
 * <p>Producto de pack sobre una oferta `POR_PACK` → venta de un pase a la persona (deuda sin cobro)
 * → la asistencia PRESENTE a una clase de esa oferta consume un credito → el ledger lo explica
 * (compra +2, consumo -1) → la cuenta corriente muestra la deuda de la venta, que no tiene sesion.
 *
 * <p>Los datos son del spec: oferta, clase, persona y producto con nonce. El producto se crea por
 * pantalla, que es lo que se prueba.
 */

const PRODUCTOS = /\/consultorios\/\d+\/productos$/;
const VENTA = /\/consultorios\/\d+\/pases$/;
const LOTE = /\/clases\/\d+\/asistencias\/lote$/;

function filaDe(page: Page, texto: string) {
  return page.getByRole('row').filter({ hasText: texto });
}

test.describe('Pases contra el backend real', () => {
  let clase: ClaseDePack;

  test.beforeEach(async ({ page, api, centro }) => {
    clase = await claseDePackConUnaInscripta(api, centro);
    await ingresar(page, centro);
  });

  test('producto, venta, consumo por asistencia, ledger y deuda sin sesion', async ({ page }) => {
    const producto = `Pack 2 clases ${nonce()}`;
    const { persona } = clase;

    // ---- Catalogo: el alta solo ofrece ofertas POR_PACK.
    await navegar(page, '/productos');
    await expect(page.getByRole('heading', { name: 'Productos de pack', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Nuevo producto' }).click();
    await page.getByLabel('Oferta').selectOption({ label: clase.ofertaNombre });
    await page.getByLabel('Nombre', { exact: true }).fill(producto);
    await page.getByLabel('Creditos').fill('2');
    await page.getByLabel('Precio').fill('15000');
    await page.getByLabel('Dias de vigencia').fill('60');
    const alta = respuestaDe(page, 'POST', PRODUCTOS);
    await page.getByRole('button', { name: 'Crear producto' }).click();
    expect((await alta).status()).toBe(201);
    await expect(page.getByText(`Se creo "${producto}"`)).toBeVisible();
    await expect(filaDe(page, producto)).toContainText('2 creditos');

    // ---- Venta: crea el pase y una deuda, sin cobrar.
    await navegar(page, `/pacientes/${persona.id}/pases`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(persona.apellido);
    await expect(page.getByText('no compro ningun pase en esta sede')).toBeVisible();
    // La opcion dice "nombre — creditos, precio": se elige por el valor de la que nombra al producto.
    const selector = page.getByLabel('Producto');
    const valor = await selector.locator('option', { hasText: producto }).getAttribute('value');
    await selector.selectOption(valor ?? '');
    const venta = respuestaDe(page, 'POST', VENTA);
    await page.getByRole('button', { name: 'Vender pase' }).click();
    const respuestaVenta = await venta;
    expect(respuestaVenta.status()).toBe(201);
    const vendida = (await respuestaVenta.json()) as {
      pase: { id: number };
      deuda: { estado: string };
    };
    expect(vendida.deuda.estado).toBe('PENDIENTE');
    await expect(page.getByText(`Se vendio "${producto}"`)).toBeVisible();
    await expect(filaDe(page, producto)).toContainText('2 de 2');

    // ---- Asistencia: presente en una clase de la oferta del pase consume un credito.
    await navegar(page, `/asistencia/${clase.claseId}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(clase.titulo);
    const inicio = respuestaDe(page, 'POST', /\/clases\/\d+\/inicio$/);
    await page.getByRole('button', { name: 'Iniciar clase' }).click();
    expect((await inicio).status()).toBe(200);
    await filaDe(page, persona.apellido)
      .getByRole('group', { name: /Asistencia de/ })
      .getByLabel('Presente', { exact: true })
      .check();
    const lote = respuestaDe(page, 'POST', LOTE);
    await page.getByRole('button', { name: /Guardar asistencia \(1\)/ }).click();
    const respuestaLote = await lote;
    expect(respuestaLote.status()).toBe(200);
    const cuerpoLote = (await respuestaLote.json()) as {
      items: {
        resultado?: { consumoDeCredito?: { efecto: string; paseId: number; saldo: number } };
      }[];
    };
    expect(cuerpoLote.items[0].resultado?.consumoDeCredito).toEqual(
      expect.objectContaining({ efecto: 'CONSUMIDO', paseId: vendida.pase.id, saldo: 1 }),
    );
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: 'consumio un credito del pase; le quedan 1 credito' }),
    ).toBeVisible();

    // ---- Ledger: compra +2, consumo -1, saldo 1.
    await navegar(page, `/pacientes/${persona.id}/pases`);
    await expect(filaDe(page, producto)).toContainText('1 de 2');
    await page.getByRole('button', { name: `Ver movimientos de ${producto}` }).click();
    const movimientos = page.getByRole('region', { name: 'Movimientos del pase' });
    await expect(movimientos.getByRole('row')).toHaveCount(3);
    await expect(filaDe(page, 'Compra')).toContainText('+2');
    await expect(filaDe(page, 'Consumo')).toContainText('-1');
    await expect(filaDe(page, 'Consumo')).toContainText('asistencia a una clase');

    // ---- Cuenta corriente: la deuda de la venta, sin sesion, se lista con su origen.
    await navegar(page, `/pacientes/${persona.id}/cuenta-corriente`);
    await expect(filaDe(page, producto)).toContainText('Venta de pase');
  });
});
