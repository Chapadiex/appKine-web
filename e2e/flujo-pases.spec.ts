import { randomUUID } from 'node:crypto';

import { Page } from '@playwright/test';

import { nonce } from './support/akine';
import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { crearOferta, fechaLocal } from './support/sembrado';
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
 *
 * <p>Desde 08.07/08.08 (contrato 0.109.0) tambien: ajuste manual del saldo y anulacion del pase con
 * su deuda (la administradora del centro tiene `pase:adjust`), y el abono por periodo con el 409
 * `abono-periodo-superpuesto` al venderlo dos veces.
 *
 * <p>Desde 08.08 (contrato 0.116.0): la venta de un abono con renovacion automatica, apagarla desde
 * la fila, y el ledger paginado de un pase con mas movimientos que una pagina.
 */

const PRODUCTOS = /\/consultorios\/\d+\/productos$/;
const VENTA = /\/consultorios\/\d+\/pases$/;
const LOTE = /\/clases\/\d+\/asistencias\/lote$/;
const AJUSTE = /\/pases\/\d+\/ajustes$/;
const ANULACION = /\/pases\/\d+\/anulacion$/;
const RENOVACION = /\/pases\/\d+\/renovacion$/;
const MOVIMIENTOS = /\/pases\/\d+\/movimientos(\?|$)/;

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
    // 0.111.0: los creditos usados se ven junto al saldo, y un pase con asistencias no se anula.
    await expect(filaDe(page, producto)).toContainText('1 usado');
    await expect(
      filaDe(page, producto).getByRole('button', { name: `Anular ${producto}` }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: `Ver movimientos de ${producto}` }).click();
    const movimientos = page.getByRole('region', { name: 'Movimientos del pase' });
    await expect(movimientos.getByRole('row')).toHaveCount(3);
    await expect(filaDe(page, 'Compra')).toContainText('+2');
    await expect(filaDe(page, 'Consumo')).toContainText('-1');
    await expect(filaDe(page, 'Consumo')).toContainText('asistencia a una clase');

    // ---- Cuenta corriente: la deuda de la venta, sin sesion, se lista con su origen.
    await navegar(page, `/pacientes/${persona.id}/cuenta-corriente`);
    await expect(filaDe(page, producto)).toContainText('Venta de pase');
    // 0.114.0: la deuda de una venta no se anula sola (409 obligacion-de-venta). La fila no ofrece
    // "Anular" y manda a los pases, donde anular el pase anula las dos cosas.
    await expect(filaDe(page, producto).getByRole('button', { name: 'Anular' })).toHaveCount(0);
    await filaDe(page, producto).getByRole('link', { name: 'Anular desde los pases' }).click();
    await expect(page).toHaveURL(new RegExp(`/pacientes/${persona.id}/pases$`));
  });

  test('ajuste manual del saldo y anulacion del pase con su deuda (08.07)', async ({
    page,
    api,
    centro,
  }) => {
    const producto = `Pack 3 clases ${nonce()}`;
    const { persona } = clase;
    const base = `/api/v1/consultorios/${centro.consultorioId}`;
    const creado = await api.exigir<{ id: number }>('POST', `${base}/productos`, {
      ofertaId: clase.ofertaId,
      nombre: producto,
      creditos: 3,
      precio: 9000,
      moneda: 'ARS',
      vigenciaDias: 30,
      vigenciaDesde: fechaLocal(centro.timezone),
    });
    await api.exigir('POST', `${base}/pases`, {
      productoId: creado.id,
      personaId: persona.id,
      idempotencyKey: randomUUID(),
    });

    await navegar(page, `/pacientes/${persona.id}/pases`);
    await expect(filaDe(page, producto)).toContainText('3 de 3');

    // ---- Ajuste: fuera de rango lo frena la pantalla; -1 con motivo lo registra el backend.
    await filaDe(page, producto)
      .getByRole('button', { name: `Ajustar saldo de ${producto}` })
      .click();
    await page.getByLabel('Creditos a sumar o restar').fill('1');
    await expect(page.getByText('El saldo tiene que quedar entre 0 y 3.')).toBeVisible();
    await page.getByLabel('Creditos a sumar o restar').fill('-1');
    await expect(page.getByText('El saldo quedaria en 2 de 3.')).toBeVisible();
    await page.getByLabel('Motivo', { exact: true }).fill('Clase de cortesia descontada');
    const ajuste = respuestaDe(page, 'POST', AJUSTE);
    await page.getByRole('button', { name: 'Ajustar saldo', exact: true }).click();
    expect((await ajuste).status()).toBe(200);
    await expect(page.getByText(`Se ajusto el saldo de "${producto}"`)).toBeVisible();
    await expect(filaDe(page, producto)).toContainText('2 de 3');
    // El ajuste manual no cuenta como credito usado: el pase sigue anulable.
    await expect(filaDe(page, producto)).toContainText('0 usados');

    await page.getByRole('button', { name: `Ver movimientos de ${producto}` }).click();
    const movimientos = page.getByRole('region', { name: 'Movimientos del pase' });
    await expect(movimientos.getByRole('row')).toHaveCount(3);
    await expect(movimientos.getByRole('row').filter({ hasText: 'Ajuste' })).toContainText(
      'Motivo: Clase de cortesia descontada',
    );

    // ---- Anulacion: sin creditos usados y sin cobros, anula el pase y su deuda.
    await filaDe(page, producto)
      .getByRole('button', { name: `Anular ${producto}` })
      .click();
    await expect(page.getByText('queda anulada, no borrada')).toBeVisible();
    await page.getByLabel('Motivo de la anulacion').fill('Vendido por error');
    const anulacion = respuestaDe(page, 'POST', ANULACION);
    await page.getByRole('button', { name: 'Anular pase' }).click();
    const respuesta = await anulacion;
    expect(respuesta.status()).toBe(200);
    const cuerpo = (await respuesta.json()) as {
      anulado: boolean;
      pase: { estado: string; creditosDisponibles: number };
      deuda: { estado: string };
    };
    expect(cuerpo).toEqual(
      expect.objectContaining({
        anulado: true,
        pase: expect.objectContaining({ estado: 'ANULADO', creditosDisponibles: 0 }),
        deuda: expect.objectContaining({ estado: 'ANULADA' }),
      }),
    );
    await expect(page.getByText(`Se anulo "${producto}" y su saldo se descarto.`)).toBeVisible();
    await expect(filaDe(page, producto)).toContainText('Anulado');
    await expect(filaDe(page, producto)).toContainText('Motivo: Vendido por error');
    await expect(
      filaDe(page, producto).getByRole('button', { name: `Anular ${producto}` }),
    ).toHaveCount(0);
  });

  test('abono por periodo y el periodo superpuesto (08.08)', async ({ page, api, centro }) => {
    const ofertaNombre = `Gimnasio abono E2E ${nonce()}`;
    await crearOferta(api, centro, {
      nombre: ofertaNombre,
      habilitarProfesional: false,
      extra: {
        modalidad: 'GRUPAL',
        capacidad: 8,
        requiereProfesional: false,
        esquemaCobro: 'POR_ABONO',
      },
    });
    const abono = `Abono mensual ${nonce()}`;

    // ---- Catalogo: el tipo ABONO solo ofrece ofertas POR_ABONO.
    await navegar(page, '/productos');
    await page.getByRole('button', { name: 'Nuevo producto' }).click();
    await page.getByLabel('Tipo').selectOption('ABONO');
    await page.getByLabel('Oferta').selectOption({ label: ofertaNombre });
    await page.getByLabel('Nombre', { exact: true }).fill(abono);
    await page.getByLabel('Asistencias por periodo').fill('8');
    await page.getByLabel('Precio').fill('20000');
    await page.getByLabel('Dias maximos del periodo').fill('30');
    const alta = respuestaDe(page, 'POST', PRODUCTOS);
    await page.getByRole('button', { name: 'Crear producto' }).click();
    expect((await alta).status()).toBe(201);
    await expect(filaDe(page, abono)).toContainText('Periodo de hasta 30 dias');

    // ---- Venta del periodo que empieza hoy.
    const { persona } = clase;
    await navegar(page, `/pacientes/${persona.id}/pases`);
    const selector = page.getByLabel('Producto');
    const valor = await selector.locator('option', { hasText: abono }).getAttribute('value');
    await selector.selectOption(valor ?? '');
    await expect(page.getByLabel('Periodo desde')).toHaveValue(fechaLocal(centro.timezone));
    const venta = respuestaDe(page, 'POST', VENTA);
    await page.getByRole('button', { name: 'Vender pase' }).click();
    const respuestaVenta = await venta;
    expect(respuestaVenta.status()).toBe(201);
    const vendida = (await respuestaVenta.json()) as { pase: { tipo: string } };
    expect(vendida.pase.tipo).toBe('ABONO');
    await expect(filaDe(page, abono)).toContainText('Abono');
    await expect(filaDe(page, abono)).toContainText('8 de 8');

    // ---- El mismo periodo otra vez: 409 abono-periodo-superpuesto, sin vender nada.
    await selector.selectOption(valor ?? '');
    const repetida = respuestaDe(page, 'POST', VENTA);
    await page.getByRole('button', { name: 'Vender pase' }).click();
    const respuestaRepetida = await repetida;
    expect(respuestaRepetida.status()).toBe(409);
    expect(((await respuestaRepetida.json()) as { type: string }).type).toMatch(
      /abono-periodo-superpuesto$/,
    );
    await expect(page.getByText('ya tiene ese abono en un periodo que se superpone')).toBeVisible();
    await expect(filaDe(page, abono)).toHaveCount(1);
  });

  test('abono con renovacion automatica: venderlo pidiendola y apagarla (08.08)', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro, {
      nombre: `Gimnasio renovable E2E ${nonce()}`,
      habilitarProfesional: false,
      extra: {
        modalidad: 'GRUPAL',
        capacidad: 8,
        requiereProfesional: false,
        esquemaCobro: 'POR_ABONO',
      },
    });
    const abono = `Abono renovable ${nonce()}`;
    await api.exigir('POST', `/api/v1/consultorios/${centro.consultorioId}/productos`, {
      ofertaId: oferta.id,
      tipo: 'ABONO',
      nombre: abono,
      creditos: 8,
      precio: 20000,
      moneda: 'ARS',
      vigenciaDias: 30,
      vigenciaDesde: fechaLocal(centro.timezone),
    });

    const { persona } = clase;
    await navegar(page, `/pacientes/${persona.id}/pases`);
    const selector = page.getByLabel('Producto');
    const valor = await selector.locator('option', { hasText: abono }).getAttribute('value');
    await selector.selectOption(valor ?? '');
    const casilla = page.getByLabel('Renovar automaticamente');
    await expect(casilla).not.toBeChecked();
    await casilla.check();
    const venta = respuestaDe(page, 'POST', VENTA);
    await page.getByRole('button', { name: 'Vender pase' }).click();
    const respuestaVenta = await venta;
    expect(respuestaVenta.status()).toBe(201);
    expect(respuestaVenta.request().postDataJSON()).toEqual(
      expect.objectContaining({ renovacionAutomatica: true }),
    );
    const vendida = (await respuestaVenta.json()) as {
      pase: { renovacionAutomatica?: boolean };
    };
    expect(vendida.pase.renovacionAutomatica).toBe(true);
    await expect(
      page.getByText('Se va a renovar solo al terminar el periodo.').first(),
    ).toBeVisible();
    await expect(filaDe(page, abono)).toContainText('Se renueva solo al terminar el periodo.');

    // ---- Apagarla desde la fila: PUT con la version leida, y la fila lo dice.
    const renovacion = respuestaDe(page, 'PUT', RENOVACION);
    await filaDe(page, abono)
      .getByRole('button', { name: `Desactivar la renovacion automatica de ${abono}` })
      .click();
    const respuestaRenovacion = await renovacion;
    expect(respuestaRenovacion.status()).toBe(200);
    expect(respuestaRenovacion.request().postDataJSON()).toEqual(
      expect.objectContaining({ activa: false }),
    );
    await expect(page.getByText(`"${abono}" ya no se renueva solo.`)).toBeVisible();
    await expect(filaDe(page, abono)).toContainText('No se renueva solo.');
    await expect(
      filaDe(page, abono).getByRole('button', {
        name: `Activar la renovacion automatica de ${abono}`,
      }),
    ).toBeVisible();
  });

  test('el ledger de un pase con mas de una pagina de movimientos (08.08)', async ({
    page,
    api,
    centro,
  }) => {
    const producto = `Pack largo ${nonce()}`;
    const { persona } = clase;
    const base = `/api/v1/consultorios/${centro.consultorioId}`;
    const creado = await api.exigir<{ id: number }>('POST', `${base}/productos`, {
      ofertaId: clase.ofertaId,
      nombre: producto,
      creditos: 10,
      precio: 9000,
      moneda: 'ARS',
      vigenciaDias: 30,
      vigenciaDesde: fechaLocal(centro.timezone),
    });
    const vendido = await api.exigir<{ pase: { id: number; version: number } }>(
      'POST',
      `${base}/pases`,
      { productoId: creado.id, personaId: persona.id, idempotencyKey: randomUUID() },
    );
    // Compra + 21 ajustes = 22 movimientos: una pagina de 20 y otra de 2.
    let version = vendido.pase.version;
    for (let i = 0; i < 21; i++) {
      const ajustado = await api.exigir<{ pase: { version: number } }>(
        'POST',
        `${base}/pases/${vendido.pase.id}/ajustes`,
        { cantidad: i % 2 === 0 ? -1 : 1, motivo: `Ajuste E2E ${i + 1}`, version },
      );
      version = ajustado.pase.version;
    }

    await navegar(page, `/pacientes/${persona.id}/pases`);
    const primera = respuestaDe(page, 'GET', MOVIMIENTOS);
    await page.getByRole('button', { name: `Ver movimientos de ${producto}` }).click();
    expect((await primera).status()).toBe(200);
    const movimientos = page.getByRole('region', { name: 'Movimientos del pase' });
    await expect(
      page.getByText('Movimientos 1 a 20 de 22, del mas viejo al mas nuevo.'),
    ).toBeVisible();
    // Encabezado + 20 filas; la primera es la compra, la mas vieja.
    await expect(movimientos.getByRole('row')).toHaveCount(21);
    await expect(movimientos.getByRole('row').nth(1)).toContainText('Compra');
    const paginas = page.getByRole('navigation', { name: 'Paginas de movimientos del pase' });
    await expect(paginas).toContainText('Pagina 1 de 2');

    const segunda = respuestaDe(page, 'GET', MOVIMIENTOS);
    await paginas.getByRole('button', { name: 'Siguiente' }).click();
    expect((await segunda).status()).toBe(200);
    await expect(
      page.getByText('Movimientos 21 a 22 de 22, del mas viejo al mas nuevo.'),
    ).toBeVisible();
    await expect(movimientos.getByRole('row')).toHaveCount(3);
    await expect(movimientos).toContainText('Motivo: Ajuste E2E 21');
    await expect(paginas.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });
});
