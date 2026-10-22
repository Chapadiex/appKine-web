import { Locator, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { abrirAcciones } from './support/filtros';
import {
  ApiAkine,
  Centro,
  DIAS,
  Obligacion,
  cerrarSesionDelTurno,
  comoProfesional,
  crearOferta,
  crearPersona,
  diaDeTrabajo,
  fijarPrecio,
  obligacionesDe,
  reservarElPrimeroLibre,
} from './support/sembrado';

/**
 * E2E de lo que se hace con un cobro despues de registrarlo (F-3, web #33) contra el backend REAL:
 * imputar el saldo a favor a una deuda, anular el cobro (la deuda recupera su saldo) y reintegrar
 * en dinero parte del saldo a favor de otro.
 *
 * <p>`flujo-caja` y `flujo-prepago` cubren el ALTA del cobro; ninguno lo anula, lo reintegra ni
 * imputa despues. Todo va por TRANSFERENCIA: el efectivo exige la caja abierta, y la caja de la sede
 * es una sola y la opera `flujo-caja.spec.ts`.
 */

const PRECIO = 8500;

interface Cobro {
  readonly id: number;
  readonly comprobanteNumero: number;
}

/** Anticipo por transferencia, sin imputar: todo queda a favor de la persona. */
function anticipo(api: ApiAkine, centro: Centro, personaId: number, total: number) {
  return api.exigir<Cobro>('POST', `/api/v1/consultorios/${centro.consultorioId}/cobros`, {
    personaId,
    total,
    anticipo: total,
    moneda: 'ARS',
    medios: [
      { medio: 'TRANSFERENCIA', importe: total, referencia: `TRF-${randomUUID().slice(0, 8)}` },
    ],
    imputaciones: [],
    idempotencyKey: randomUUID(),
  });
}

/** Fila de una tabla por la celda EXACTA del comprobante: "N.º 3" no tiene que matchear "N.º 30". */
function porComprobante(page: Page, tabla: Locator, cobro: Cobro): Locator {
  return tabla.getByRole('row').filter({
    has: page.getByRole('cell', { name: `N.º ${cobro.comprobanteNumero}`, exact: true }),
  });
}

function filaDeCobro(page: Page, cobro: Cobro): Locator {
  return porComprobante(page, page.getByRole('region', { name: 'Cobros de la persona' }), cobro);
}

async function deuda(api: ApiAkine, centro: Centro, id: number): Promise<Obligacion> {
  return api.exigir('GET', `/api/v1/consultorios/${centro.consultorioId}/obligaciones/${id}`);
}

test.describe('Imputacion posterior, anulacion y reintegro de cobros contra el backend real', () => {
  let profesional: ApiAkine;

  test.beforeAll(async ({ centro }) => {
    profesional = await comoProfesional(centro);
  });

  test.afterAll(async () => {
    await profesional.cerrar();
  });

  test('imputar el saldo a favor, anular el cobro y reintegrar parte de otro', async ({
    page,
    api,
    centro,
  }) => {
    test.slow();
    const oferta = await crearOferta(api, centro);
    await fijarPrecio(api, centro, oferta, PRECIO);
    const persona = await crearPersona(api);
    const { slots } = await diaDeTrabajo(api, centro, oferta.id, DIAS.cobrosPosteriores);
    const turno = await reservarElPrimeroLibre(api, centro, oferta.id, persona.id, slots);
    await cerrarSesionDelTurno(profesional, centro, turno.id);
    const [pendiente] = await obligacionesDe(api, centro, persona.id);
    expect(pendiente?.saldo, 'el cierre devengo la deuda').toBe(PRECIO);

    // Un anticipo de 10.000 que llego antes de saber cuanto se debia.
    const cobroA = await anticipo(api, centro, persona.id, 10000);

    // --- 1. Imputacion posterior desde la cuenta corriente -----------------------------------
    await ingresar(page, centro);
    await navegar(page, `/pacientes/${persona.id}/cuenta-corriente`);
    const aFavor = page.getByRole('region', { name: 'Cobros con saldo a favor' });
    const filaA = porComprobante(page, aFavor, cobroA);
    await expect(filaA).toContainText('10.000,00');
    await filaA.getByRole('button', { name: 'Imputar a deudas' }).click();
    await page.locator(`#imputar-${cobroA.id}-${pendiente.id}`).fill(String(PRECIO));
    const imputacion = respuestaDe(page, 'POST', /\/cobros\/\d+\/imputaciones$/);
    await page.getByRole('button', { name: 'Imputar', exact: true }).click();
    expect((await imputacion).status()).toBeLessThan(300);
    await expect(
      page.getByText(`Se imputo el saldo a favor del comprobante N.º ${cobroA.comprobanteNumero}`),
    ).toBeVisible();
    await expect(filaA).toContainText('1.500,00');
    const imputada = await deuda(api, centro, pendiente.id);
    expect(imputada.estado).toBe('PAGADA');
    expect(imputada.saldo).toBe(0);

    // --- 2. Anular el cobro: la deuda recupera lo que se le habia imputado --------------------
    await navegar(page, `/pacientes/${persona.id}/cuenta-corriente/cobros`);
    await abrirAcciones(filaDeCobro(page, cobroA));
    await filaDeCobro(page, cobroA).getByRole('button', { name: 'Anular' }).click();
    await page
      .getByLabel('Motivo de la anulacion')
      .fill('La transferencia fue rechazada por el banco');
    const anulacion = respuestaDe(page, 'POST', /\/cobros\/\d+\/anulacion$/);
    await page.getByRole('button', { name: 'Anular el cobro' }).click();
    expect((await anulacion).status()).toBeLessThan(300);
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: `Se anulo el comprobante N.º ${cobroA.comprobanteNumero}` }),
    ).toBeVisible();
    // Desde el contrato 0.90.0 el listado trae tambien los anulados: la fila queda, marcada como
    // anulada, y la pantalla dice por que ya no se puede anular de nuevo.
    const filaAnulada = filaDeCobro(page, cobroA);
    await expect(filaAnulada).toBeVisible();
    await expect(filaAnulada).toContainText('Anulado');
    await abrirAcciones(filaAnulada);
    await expect(filaAnulada.getByRole('button', { name: 'Anular' })).toBeDisabled();
    await expect(filaAnulada).toContainText('No se puede anular: ya esta anulado.');
    const anulado = await api.exigir<{ estado: string }>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/cobros/${cobroA.id}`,
    );
    expect(anulado.estado).toBe('ANULADO');
    const devuelta = await deuda(api, centro, pendiente.id);
    expect(devuelta.estado).toBe('PENDIENTE');
    expect(devuelta.saldo).toBe(PRECIO);

    // --- 3. Reintegro de parte del saldo a favor de otro cobro ---------------------------------
    const cobroB = await anticipo(api, centro, persona.id, 3000);
    await page.reload();
    const filaB = filaDeCobro(page, cobroB);
    await expect(filaB).toContainText('3.000,00');
    await abrirAcciones(filaB);
    await filaB.getByRole('button', { name: 'Reintegrar saldo a favor' }).click();
    const importe = page.locator(`#reintegro-importe-${cobroB.id}`);
    // Mas de lo que hay a favor: lo frena la pantalla antes de salir a la red.
    await importe.fill('4000');
    await page.locator(`#reintegro-motivo-${cobroB.id}`).fill('Devolucion parcial del anticipo');
    await page.getByRole('button', { name: 'Reintegrar', exact: true }).click();
    await expect(importe).toHaveAttribute('aria-invalid', 'true');

    await importe.fill('1000');
    await page.locator(`#reintegro-medio-${cobroB.id}`).selectOption('TRANSFERENCIA');
    const reintegro = respuestaDe(page, 'POST', /\/cobros\/\d+\/reintegros$/);
    await page.getByRole('button', { name: 'Reintegrar', exact: true }).click();
    expect((await reintegro).status()).toBeLessThan(300);
    await expect(
      page.getByRole('status').filter({ hasText: /Se devolvieron .*1\.000,00/ }),
    ).toContainText(/Al cobro le quedan .*2\.000,00 a favor/);
    await expect(filaDeCobro(page, cobroB)).toContainText('2.000,00');
    // Con plata ya devuelta, anularlo sacaria esa plata dos veces: la pantalla dice por que no.
    await abrirAcciones(filaDeCobro(page, cobroB));
    await expect(filaDeCobro(page, cobroB).getByRole('button', { name: 'Anular' })).toBeDisabled();
    await expect(filaDeCobro(page, cobroB)).toContainText('ya devolvio parte de su saldo a favor');

    // La cuenta corriente lo refleja: el saldo a favor que queda es el de B.
    await navegar(page, `/pacientes/${persona.id}/cuenta-corriente`);
    await expect(porComprobante(page, aFavor, cobroB)).toContainText('2.000,00');
    await expect(porComprobante(page, aFavor, cobroA)).toHaveCount(0);
  });
});
