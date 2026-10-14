import { Locator, Page } from '@playwright/test';

import { nonce } from './support/akine';
import { expect, ingresar, navegar, test } from './support/agenda-real';
import { ApiAkine, comoProfesional } from './support/sembrado';
import { DIAS_PANTALLAS_098, sembrarPrestacionFinanciada } from './support/sembrado-pantallas-098';

/**
 * E2E de la marca "consumos a revisar" por fila en Ordenes y autorizaciones (web #74, api #98:
 * `consumosARevisar` en el listado) contra el backend REAL.
 *
 * <p>El panel de saldo y la reversion desde la pantalla los recorre `flujo-autorizaciones`. Lo que se
 * prueba aca es la TABLA: la fila de la autorizacion no lleva marca mientras el consumo esta sano,
 * la lleva cuando se anula la deuda de la sesion que consumio (DP-13: la unidad no vuelve sola), y la
 * pierde cuando el consumo se revierte. Las dos mutaciones van por la API: la marca la calcula el
 * backend y la pantalla solo la lee.
 */

const IMPORTES = { total: 12000, financiador: 9600, coseguro: 2400 };

function filaDeAutorizacion(page: Page, numero: string): Locator {
  return page
    .getByRole('table', { name: /autorizacion\(es\) del paciente/ })
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: new RegExp(`^${numero}(\\s|$)`) }) });
}

/**
 * Vuelve a leer la pantalla pasando por la ficha: navegar a la misma URL no recarga. Se espera a que
 * la ficha se dibuje antes de volver —si no, el router descarta la navegacion intermedia, ve
 * "autorizaciones → autorizaciones" y no relee— y a que llegue el listado nuevo.
 */
async function releer(page: Page, personaId: number, numero: string): Promise<Locator> {
  await navegar(page, `/pacientes/${personaId}`);
  await expect(
    page.getByRole('heading', { name: 'Datos administrativos', level: 2, exact: true }),
  ).toBeVisible();
  const listado = page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      new URL(r.url()).pathname === `/api/v1/personas/${personaId}/autorizaciones`,
  );
  await navegar(page, `/pacientes/${personaId}/autorizaciones`);
  expect((await listado).status()).toBe(200);
  const fila = filaDeAutorizacion(page, numero);
  await expect(fila).toHaveCount(1);
  return fila;
}

test.describe('Consumos a revisar por fila contra el backend real', () => {
  let profesional: ApiAkine;

  test.beforeAll(async ({ centro }) => {
    profesional = await comoProfesional(centro);
  });

  test.afterAll(async () => {
    await profesional.cerrar();
  });

  test('la fila se marca al anular la deuda del consumo y se desmarca al revertirlo', async ({
    page,
    api,
    centro,
  }) => {
    test.slow();
    const numero = `AUT-${nonce()}`;
    const sembrado = await sembrarPrestacionFinanciada(
      api,
      profesional,
      centro,
      DIAS_PANTALLAS_098.consumosARevisar,
      IMPORTES,
      { numero, cantidad: 4 },
    );
    const { persona, coseguro } = sembrado;
    const autorizacionId = sembrado.autorizacionId!;

    // --- Consumo sano: sin marca ----------------------------------------------------------
    await ingresar(page, centro);
    let fila = await releer(page, persona.id, numero);
    await expect(fila).toContainText('3 de 4');
    await expect(fila).not.toContainText('a revisar');

    // --- Se anula el coseguro de la sesion que consumio: la fila se marca -----------------
    await api.exigir(
      'DELETE',
      `/api/v1/consultorios/${centro.consultorioId}/obligaciones/${coseguro.id}`,
      { motivo: `Cortesia del centro ${nonce()}`, version: coseguro.version },
    );
    fila = await releer(page, persona.id, numero);
    await expect(fila.locator('.etiqueta')).toHaveText('1 consumo a revisar');

    // --- Se revierte el consumo: la marca desaparece --------------------------------------
    const movimientos = await api.exigir<{ id: number; tipo: string }[]>(
      'GET',
      `/api/v1/autorizaciones/${autorizacionId}/movimientos`,
    );
    const consumo = movimientos.find((m) => m.tipo === 'CONSUMO');
    expect(consumo, 'el cierre dejo el consumo en el ledger').toBeDefined();
    await api.exigir('POST', `/api/v1/autorizaciones/${autorizacionId}/reversiones`, {
      movimientoId: consumo!.id,
      motivo: 'La sesion fue una cortesia: no corresponde consumir',
    });
    fila = await releer(page, persona.id, numero);
    await expect(fila).toContainText('4 de 4');
    await expect(fila).not.toContainText('a revisar');
  });
});
