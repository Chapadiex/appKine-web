import { Page } from '@playwright/test';

import { navegar, ingresar, problemaDe, respuestaDe } from './support/agenda-real';
import {
  CentroPropio,
  cerrarCentroPropio,
  dato,
  expect,
  movimientoDeCaja,
  sembrarCentroPropio,
} from './support/centro-propio';
import {
  abrirLaCaja,
  cajaAbierta,
  cerrarSesionDelTurno,
  crearOferta,
  crearPersona,
  dejarLaCajaCerrada,
  diaDeTrabajo,
  fijarPrecio,
  obligacionesDe,
  Persona,
  reservarElPrimeroLibre,
  uriDeProblema,
} from './support/sembrado';
import { test } from '@playwright/test';

/**
 * E2E del cobro en EFECTIVO que se anula, contra el backend real (M19 + M20, F-3).
 *
 * <p>Es el camino de mas riesgo de la plata del mostrador y el unico que ningun spec recorria: la
 * anulacion de `flujo-cobros-posteriores` es de una transferencia, que no toca el cajon, y el cobro
 * en efectivo de `flujo-caja` nunca se anula. Lo que se afirma es lo que un error no perdonaria:
 *
 * <ul>
 *   <li>la anulacion devuelve la deuda a PENDIENTE con su saldo entero;</li>
 *   <li>el cajon recibe el contramovimiento: el teorico vuelve al saldo inicial y el arqueo cierra
 *       sin diferencia contando solo eso;</li>
 *   <li>anular dos veces el mismo cobro lo rechaza el servidor con su tipo, y no mueve la caja.</li>
 * </ul>
 *
 * <p>Centro propio (`support/centro-propio.ts`): la caja es una por sede.
 */
test.describe.configure({ mode: 'default' });

const PRECIO = 8500;
const INICIAL = 1000;

test.describe('Cobro en efectivo anulado contra el backend real', () => {
  let propio: CentroPropio;
  let persona: Persona;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    propio = await sembrarCentroPropio('cobroefectivo');
    const { api, profesional, centro } = propio;
    const oferta = await crearOferta(api, centro);
    await fijarPrecio(api, centro, oferta, PRECIO);
    persona = await crearPersona(api);
    const { slots } = await diaDeTrabajo(api, centro, oferta.id, 2);
    const turno = await reservarElPrimeroLibre(api, centro, oferta.id, persona.id, slots);
    await cerrarSesionDelTurno(profesional, centro, turno.id);
  });

  test.afterAll(async () => {
    if (propio !== undefined) {
      await dejarLaCajaCerrada(propio.api, propio.centro);
    }
    await cerrarCentroPropio(propio);
  });

  test('cobrar en efectivo, anular el cobro: la deuda vuelve y el cajon tambien', async ({
    page,
  }) => {
    test.slow();
    const { api, centro } = propio;
    const [deuda] = await obligacionesDe(api, centro, persona.id);
    expect(deuda?.estado, 'el cierre de la sesion devengo la deuda').toBe('PENDIENTE');
    await dejarLaCajaCerrada(api, centro);
    await abrirLaCaja(api, centro, INICIAL);

    await ingresar(page, centro);
    const cobro = await cobrarEnEfectivo(page, persona);

    const pagada = await api.exigir<{ estado: string; saldo: number }>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/obligaciones/${deuda.id}`,
    );
    expect(pagada.estado).toBe('PAGADA');

    await navegar(page, '/caja');
    await expect(page.getByRole('heading', { name: 'Caja abierta' })).toBeVisible();
    await expect(dato(page, 'Deberia haber en el cajon')).toContainText('9.500,00');
    await expect(movimientoDeCaja(page, `Cobro ${cobro.id}`)).toContainText('+ $');

    // --- Anular desde el listado de cobros de la persona ---------------------------------------
    await navegar(page, `/pacientes/${persona.id}/cuenta-corriente/cobros`);
    const fila = page
      .getByRole('region', { name: 'Cobros de la persona' })
      .getByRole('row')
      .filter({
        has: page.getByRole('cell', { name: `N.º ${cobro.comprobanteNumero}`, exact: true }),
      });
    await fila.getByRole('button', { name: 'Anular' }).click();
    await page.getByLabel('Motivo de la anulacion').fill('Se cobro a la persona equivocada');
    const anulacion = respuestaDe(page, 'POST', /\/cobros\/\d+\/anulacion$/);
    await page.getByRole('button', { name: 'Anular el cobro' }).click();
    expect((await anulacion).status()).toBeLessThan(300);
    await expect(fila).toContainText('Anulado');
    await expect(fila.getByRole('button', { name: 'Anular' })).toBeDisabled();

    const devuelta = await api.exigir<{ estado: string; saldo: number }>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/obligaciones/${deuda.id}`,
    );
    expect(devuelta.estado).toBe('PENDIENTE');
    expect(devuelta.saldo).toBe(PRECIO);

    // El cajon devuelve la plata: el teorico es el saldo inicial y hay UN contramovimiento.
    await navegar(page, '/caja');
    await expect(dato(page, 'Deberia haber en el cajon')).toContainText('1.000,00');
    const teorico = await cajaAbierta(api, centro);
    expect(teorico?.saldoTeorico).toBe(INICIAL);

    // Anular otra vez lo rechaza el servidor y la caja no se mueve.
    const segunda = await api.pedir(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/cobros/${cobro.id}/anulacion`,
      { motivo: 'Intento repetido por fuera de la pantalla' },
    );
    expect(segunda.status(), await segunda.text()).toBe(409);
    expect(((await segunda.json()) as { type: string }).type).toBe(uriDeProblema('cobro-anulado'));
    expect((await cajaAbierta(api, centro))?.saldoTeorico).toBe(INICIAL);

    // Arqueo contando solo el saldo inicial: cierra sin diferencia.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Caja abierta' })).toBeVisible();
    await page.getByLabel('Efectivo contado').fill(String(INICIAL));
    await expect(page.getByText('El contado coincide con el teorico.')).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar la caja' }).click();
    await expect(page.getByRole('heading', { name: 'Arqueo registrado' })).toBeVisible();
    expect(await cajaAbierta(api, centro)).toBeNull();
  });

  test('anular un cobro en efectivo exige caja abierta y plata en el cajon para devolver', async ({
    page,
  }) => {
    test.slow();
    const { api, centro } = propio;
    const [deuda] = await obligacionesDe(api, centro, persona.id);
    expect(deuda?.estado, 'la deuda sigue pendiente (el test anterior anulo su cobro)').toBe(
      'PENDIENTE',
    );
    await dejarLaCajaCerrada(api, centro);
    await abrirLaCaja(api, centro, 0);

    await ingresar(page, centro);
    const cobro = await cobrarEnEfectivo(page, persona);
    // Cierra el dia: la plata del cobro sale del cajon con el arqueo.
    await dejarLaCajaCerrada(api, centro);

    await navegar(page, `/pacientes/${persona.id}/cuenta-corriente/cobros`);
    const fila = page
      .getByRole('region', { name: 'Cobros de la persona' })
      .getByRole('row')
      .filter({
        has: page.getByRole('cell', { name: `N.º ${cobro.comprobanteNumero}`, exact: true }),
      });

    // 1. Sin caja abierta no hay cajon donde devolver el efectivo.
    await fila.getByRole('button', { name: 'Anular' }).click();
    await page.getByLabel('Motivo de la anulacion').fill('Se cobro dos veces');
    let rechazo = respuestaDe(page, 'POST', /\/cobros\/\d+\/anulacion$/);
    await page.getByRole('button', { name: 'Anular el cobro' }).click();
    let respuesta = await rechazo;
    expect(respuesta.status()).toBe(409);
    expect((await problemaDe(respuesta)).type).toBe(uriDeProblema('caja-no-abierta'));
    await expect(
      page.getByRole('alert').filter({ hasText: 'La caja de esta sede no esta abierta' }),
    ).toBeVisible();
    expect(
      (
        await api.exigir<{ estado: string }>(
          'GET',
          `/api/v1/consultorios/${centro.consultorioId}/obligaciones/${deuda.id}`,
        )
      ).estado,
      'el rechazo no toca la deuda',
    ).toBe('PAGADA');

    // 2. Caja abierta pero vacia: devolver 8.500 dejaria el cajon en negativo.
    await abrirLaCaja(api, centro, 0);
    await page.reload();
    await fila.getByRole('button', { name: 'Anular' }).click();
    await page.getByLabel('Motivo de la anulacion').fill('Se cobro dos veces');
    rechazo = respuestaDe(page, 'POST', /\/cobros\/\d+\/anulacion$/);
    await page.getByRole('button', { name: 'Anular el cobro' }).click();
    respuesta = await rechazo;
    expect(respuesta.status()).toBe(409);
    expect((await problemaDe(respuesta)).type).toBe(uriDeProblema('caja-saldo-insuficiente'));
    await expect(
      page.getByRole('alert').filter({ hasText: 'En el cajon no hay efectivo suficiente' }),
    ).toBeVisible();
    await expect(fila).not.toContainText('Anulado');
    expect((await cajaAbierta(api, centro))?.saldoTeorico).toBe(0);

    // 3. Con la plata en el cajon, se anula y el cajon vuelve a cero.
    await dejarLaCajaCerrada(api, centro);
    await abrirLaCaja(api, centro, PRECIO);
    await page.reload();
    await fila.getByRole('button', { name: 'Anular' }).click();
    await page.getByLabel('Motivo de la anulacion').fill('Se cobro dos veces');
    const anulacion = respuestaDe(page, 'POST', /\/cobros\/\d+\/anulacion$/);
    await page.getByRole('button', { name: 'Anular el cobro' }).click();
    expect((await anulacion).status()).toBeLessThan(300);
    await expect(fila).toContainText('Anulado');
    expect((await cajaAbierta(api, centro))?.saldoTeorico).toBe(0);
    const [devuelta] = await obligacionesDe(api, centro, persona.id);
    expect(devuelta.estado).toBe('PENDIENTE');
    expect(devuelta.saldo).toBe(PRECIO);
  });
});

/** Cobra el saldo entero de la deuda en efectivo desde la pantalla. */
async function cobrarEnEfectivo(
  page: Page,
  persona: Persona,
): Promise<{ id: number; comprobanteNumero: number }> {
  await navegar(page, `/pacientes/${persona.id}/cuenta-corriente/cobrar`);
  await expect(page.getByRole('heading', { name: 'Registrar un cobro', level: 1 })).toBeVisible();
  await page.getByRole('checkbox', { name: /saldo/ }).check();
  await page.getByLabel('Medio de pago').selectOption({ label: 'Efectivo' });
  await page.getByRole('button', { name: 'Completar con el total imputado' }).click();
  const alta = respuestaDe(page, 'POST', /\/cobros$/);
  await page.getByRole('button', { name: 'Registrar el cobro' }).click();
  const respuesta = await alta;
  if (respuesta.status() !== 201) {
    throw new Error(`cobro: ${respuesta.status()} ${JSON.stringify(await problemaDe(respuesta))}`);
  }
  await expect(page.getByRole('heading', { name: 'Cobro registrado' })).toBeVisible();
  return (await respuesta.json()) as { id: number; comprobanteNumero: number };
}
