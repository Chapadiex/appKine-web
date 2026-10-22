import { Locator, Page } from '@playwright/test';

import { nonce } from './support/akine';
import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import {
  ApiAkine,
  DIAS,
  cerrarSesionDelTurno,
  comoProfesional,
  crearConvenio,
  crearFinanciador,
  crearOferta,
  crearPersona,
  darCobertura,
  diaDeTrabajo,
  fechaLocal,
  obligacionesDe,
  practicaGlobal,
  reservarElPrimeroLibre,
  sumarDias,
} from './support/sembrado';

/**
 * E2E del saldo explicable de una autorizacion, su ledger y la alerta "consumo a revisar" (D-f,
 * web #58; DP-13) contra el backend REAL.
 *
 * <p>Todo el camino del consumo es el de produccion: la oferta presta `KIN_SESION` como practica
 * principal, el paciente tiene cobertura financiada con convenio y arancel, y una autorizacion
 * APROBADA de esa practica. La profesional cierra la sesion por la API y el cierre descuenta UNA
 * unidad en la misma transaccion. Desde la pantalla: el saldo y el ledger lo explican; se anula el
 * coseguro desde la cuenta corriente —la deuda se anula, la unidad NO vuelve— y aparece la alerta;
 * revertir el consumo desde el panel devuelve la unidad y resuelve la alerta.
 */

const CANTIDAD = 5;

/** El valor de un `<dt>`/`<dd>` del panel de saldo. */
function dato(panel: Locator, termino: string): Locator {
  return panel
    .locator('dt', { hasText: new RegExp(`^${termino}$`) })
    .locator('xpath=following-sibling::dd[1]');
}

function filaDeAutorizacion(page: Page, numero: string): Locator {
  return page
    .getByRole('table', { name: /autorizacion\(es\) del paciente/ })
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: new RegExp(`^${numero}(\\s|$)`) }) });
}

async function abrirElSaldo(page: Page, personaId: number, numero: string): Promise<Locator> {
  await navegar(page, `/pacientes/${personaId}/autorizaciones`);
  await filaDeAutorizacion(page, numero).getByRole('button', { name: 'Saldo y consumos' }).click();
  const panel = page.getByRole('region', { name: `Saldo y consumos de la autorización ${número}` });
  await expect(panel.getByRole('heading', { name: 'Saldo', level: 3 })).toBeVisible();
  return panel;
}

test.describe('Saldo, ledger y alerta de una autorizacion contra el backend real', () => {
  let profesional: ApiAkine;

  test.beforeAll(async ({ centro }) => {
    profesional = await comoProfesional(centro);
  });

  test.afterAll(async () => {
    await profesional.cerrar();
  });

  test('el cierre consume, anular la deuda alerta y revertir desde la pantalla devuelve la unidad', async ({
    page,
    api,
    centro,
  }) => {
    test.slow();
    const desde = sumarDias(fechaLocal(centro.timezone), -30);
    const sede = `/api/v1/consultorios/${centro.consultorioId}`;
    const numero = `AUT-${nonce()}`;

    // --- Sembrado: oferta con practica, convenio con arancel, cobertura y autorizacion -------
    const practicaId = await practicaGlobal(api, 'KIN_SESION');
    const oferta = await crearOferta(api, centro, {
      extra: { admiteObraSocial: true, precioBase: 12000, moneda: 'ARS' },
    });
    await api.exigir('PUT', `${sede}/ofertas/${oferta.id}/practicas`, {
      practicaIds: [practicaId],
      practicaPrincipalId: practicaId,
      expectedVersion: oferta.version,
    });
    const financiador = await crearFinanciador(api, desde);
    const convenio = await crearConvenio(api, centro, financiador, desde);
    await api.exigir('POST', `${sede}/convenios/${convenio.id}/aranceles`, {
      practicaId,
      importeTotal: 12000,
      importeFinanciador: 9600,
      coseguro: 2400,
      vigenciaDesde: desde,
    });
    const persona = await crearPersona(api);
    const coberturaId = await darCobertura(api, persona, financiador, desde);
    await api.exigir('POST', `/api/v1/personas/${persona.id}/autorizaciones`, {
      coberturaId,
      practicaId,
      numero,
      estadoInicial: 'APROBADA',
      cantidadAutorizada: CANTIDAD,
      vigenciaDesde: desde,
      vigenciaHasta: sumarDias(desde, 180),
    });

    const { slots } = await diaDeTrabajo(api, centro, oferta.id, DIAS.autorizacion);
    const turno = await reservarElPrimeroLibre(api, centro, oferta.id, persona.id, slots);
    const sesionId = await cerrarSesionDelTurno(profesional, centro, turno.id);

    // --- El saldo y el ledger explican el consumo -------------------------------------------
    await ingresar(page, centro);
    let panel = await abrirElSaldo(page, persona.id, numero);
    await expect(dato(panel, 'Otorgadas')).toHaveText(String(CANTIDAD));
    await expect(dato(panel, 'Consumidas')).toHaveText('1');
    await expect(dato(panel, 'Disponibles')).toHaveText(String(CANTIDAD - 1));
    await expect(dato(panel, 'Consumos a revisar')).toHaveText('0');
    await expect(panel.getByText('No hay consumos a revisar.')).toBeVisible();
    const consumo = panel.locator('li').filter({ hasText: /Consumo #\d+/ });
    await expect(consumo).toHaveCount(1);
    await expect(consumo).toContainText('Resta 1 al saldo');
    await expect(consumo).toContainText(`Cierre de la sesión #${sesionId}`);
    const consumoId = Number(/Consumo #(\d+)/.exec((await consumo.textContent()) ?? '')?.[1]);
    expect(consumoId).toBeGreaterThan(0);

    // --- Anular el coseguro desde la cuenta corriente: la unidad NO vuelve -----------------
    const [coseguro] = await obligacionesDe(api, centro, persona.id);
    expect(coseguro?.concepto, 'el cierre devengo el coseguro del paciente').toBe('COSEGURO');
    await navegar(page, `/pacientes/${persona.id}/cuenta-corriente`);
    const deudas = page.getByRole('region', { name: 'Deudas de la persona' });
    await deudas
      .getByRole('row')
      .filter({ hasText: 'Pendiente' })
      .getByRole('button', { name: 'Anular' })
      .click();
    const motivoDeAnulacion = `Cortesia del centro ${nonce()}`;
    await page.getByLabel('Motivo de la anulacion').fill(motivoDeAnulacion);
    const anulacion = respuestaDe(page, 'DELETE', /\/obligaciones\/\d+$/);
    await page.getByRole('button', { name: 'Anular la deuda' }).click();
    expect((await anulacion).status()).toBe(200);
    await expect(page.getByText(/Se anulo la deuda de/)).toBeVisible();

    panel = await abrirElSaldo(page, persona.id, numero);
    await expect(dato(panel, 'Consumidas')).toHaveText('1');
    await expect(dato(panel, 'Disponibles')).toHaveText(String(CANTIDAD - 1));
    await expect(dato(panel, 'Consumos a revisar')).toHaveText('1');
    const alerta = panel.locator('li').filter({ hasText: 'Consumo a revisar.' });
    await expect(alerta).toContainText(`la sesión #${sesionId}`);
    await expect(alerta).toContainText(`(obligacion #${coseguro.id})`);
    await expect(alerta).toContainText(`Motivo de la anulación: ${motivoDeAnulacion}`);

    // --- Revertir desde la alerta: la unidad vuelve y la alerta se resuelve ----------------
    await alerta.getByRole('button', { name: `Revertir el consumo #${consumoId}` }).click();
    await panel.getByLabel('Motivo').fill('La sesion fue una cortesia: no corresponde consumir');
    const reversion = respuestaDe(page, 'POST', /\/autorizaciones\/\d+\/reversiones$/);
    await panel.getByRole('button', { name: 'Confirmar la reversion' }).click();
    expect((await reversion).status()).toBeLessThan(300);
    await expect(panel.getByText(`Se revirtio el consumo #${consumoId}`)).toBeVisible();

    await expect(dato(panel, 'Consumidas')).toHaveText('0');
    await expect(dato(panel, 'Disponibles')).toHaveText(String(CANTIDAD));
    await expect(dato(panel, 'Consumos a revisar')).toHaveText('0');
    await expect(panel.getByText(/Resuelta: se revirtio el consumo/)).toBeVisible();
    const compensacion = panel.locator('li').filter({ hasText: /Reversion #\d+/ });
    await expect(compensacion).toContainText(`Compensa el consumo #${consumoId}`);
    await expect(compensacion).toContainText('Devuelve 1 al saldo');
    await expect(consumo).toContainText('Ya revertido');
    await expect(panel.getByRole('button', { name: /Revertir el consumo/ })).toHaveCount(0);
  });
});
