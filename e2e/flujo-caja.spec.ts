import { Page, Locator } from '@playwright/test';

import { expect, ingresar, navegar, problemaDe, respuestaDe, test } from './support/agenda-real';
import {
  ApiAkine,
  DIAS,
  cajaAbierta,
  cerrarSesionDelTurno,
  comoProfesional,
  crearOferta,
  crearPersona,
  dejarLaCajaCerrada,
  diaDeTrabajo,
  fijarPrecio,
  moverLaCaja,
  obligacionesDe,
  reservar,
  uriDeProblema,
} from './support/sembrado';

/**
 * E2E de la caja diaria (F-6, M20) y del cobro en efectivo que entra en ella (M19), contra el
 * backend REAL.
 *
 * <h2>Uno detras de otro, y siempre arrancando con la caja cerrada</h2>
 *
 * <p>La caja es UNA por sede (`uk_jornada_caja_abierta`) y el centro de la corrida es uno solo.
 * Dos tests que la abren a la vez se pisan: uno recibe `caja-ya-abierta` y el otro arquea
 * movimientos ajenos. Por eso los dos tests que la usan viven en este archivo y corren en orden
 * en el mismo worker (`mode: 'default'`), y cada uno empieza cerrando lo que haya quedado abierto
 * —por la API, arqueando el teorico— por si el anterior fallo a mitad de camino. Cerrar y volver
 * a abrir el mismo dia es valido: V54 no tiene unique sobre `fecha_negocio` (mañana y tarde).
 *
 * <p>Ningun otro spec usa efectivo: el prepago y el pago del financiador van por transferencia.
 */
test.describe.configure({ mode: 'default' });

/** El valor de una fila `<dt>`/`<dd>` de la tarjeta de la jornada. */
function dato(page: Page, termino: string): Locator {
  return page.locator('dt', { hasText: termino }).locator('xpath=following-sibling::dd[1]');
}

/** Fila de la tabla de movimientos por su concepto (unico por test). */
function movimiento(page: Page, concepto: string | RegExp): Locator {
  return page
    .getByRole('region', { name: 'Movimientos de esta jornada' })
    .getByRole('row')
    .filter({ hasText: concepto });
}

test.describe('Caja diaria contra el backend real', () => {
  test.beforeEach(async ({ page, api, centro }) => {
    await dejarLaCajaCerrada(api, centro);
    await ingresar(page, centro);
  });

  test('abrir, movimiento manual, revertir, el 409 caja-saldo-cambio y cerrar con arqueo', async ({
    page,
    api,
    centro,
  }) => {
    const sufijo = Date.now().toString(36);
    const concepto = `Cambio para el mostrador ${sufijo}`;

    await navegar(page, '/caja');
    await expect(page.getByRole('heading', { name: 'La caja esta cerrada' })).toBeVisible();
    await page.getByLabel('Saldo inicial contado').fill('1000');
    await page.getByRole('button', { name: 'Abrir la caja' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Caja abierta.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Caja abierta' })).toBeVisible();
    await expect(dato(page, 'Deberia haber en el cajon')).toContainText('1.000,00');

    // Ingreso manual en efectivo: suma al teorico.
    await page.getByLabel('Tipo').selectOption({ label: 'Ingreso' });
    await page.getByLabel('Medio').selectOption({ label: 'Efectivo' });
    await page.getByLabel('Importe').fill('250');
    await page.getByLabel('Concepto').fill(concepto);
    await page.getByRole('button', { name: 'Registrar el movimiento' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Movimiento registrado.' }),
    ).toBeVisible();
    await expect(movimiento(page, concepto)).toContainText('+ $');
    await expect(dato(page, 'Deberia haber en el cajon')).toContainText('1.250,00');

    // Un egreso que deja el cajon en negativo lo rechaza el servidor, con su tipo.
    await page.getByLabel('Tipo').selectOption({ label: 'Egreso' });
    await page.getByLabel('Importe').fill('5000');
    await page.getByLabel('Concepto').fill(`Retiro imposible ${sufijo}`);
    const rechazoEgreso = respuestaDe(page, 'POST', /\/caja\/movimientos$/);
    await page.getByRole('button', { name: 'Registrar el movimiento' }).click();
    const egreso = await rechazoEgreso;
    expect(egreso.status()).toBe(409);
    expect((await problemaDe(egreso)).type).toBe(uriDeProblema('caja-saldo-insuficiente'));
    await expect(page.getByText(/deja el cajon en negativo/)).toBeVisible();
    await expect(dato(page, 'Deberia haber en el cajon')).toContainText('1.250,00');

    // Revertir no borra: asienta el opuesto y deja el original marcado.
    await movimiento(page, concepto).getByRole('button', { name: 'Revertir' }).click();
    await page.getByLabel('Motivo de la reversion').fill('Se cargo dos veces');
    await page.getByRole('button', { name: 'Confirmar la reversion' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Movimiento revertido.' }),
    ).toBeVisible();
    await expect(movimiento(page, concepto).first()).toContainText('Revertido');
    await expect(movimiento(page, 'Reversion de ingreso')).toHaveCount(1);
    await expect(dato(page, 'Deberia haber en el cajon')).toContainText('1.000,00');

    // Mientras se cuenta, otra computadora mete efectivo: el cierre se rechaza, no se registra
    // una diferencia que no existe.
    await page.getByLabel('Efectivo contado').fill('1000');
    await expect(page.getByText('El contado coincide con el teorico.')).toBeVisible();
    await moverLaCaja(api, centro, {
      tipo: 'INGRESO',
      importe: 100,
      concepto: `Ingreso desde otro puesto ${sufijo}`,
    });
    const rechazoCierre = respuestaDe(page, 'POST', /\/caja\/jornadas\/\d+\/cierre$/);
    await page.getByRole('button', { name: 'Cerrar la caja' }).click();
    const cierre = await rechazoCierre;
    expect(cierre.status()).toBe(409);
    const problema = await problemaDe(cierre);
    expect(problema.type).toBe(uriDeProblema('caja-saldo-cambio'));
    expect(problema['saldoTeoricoActual']).toBe(1100);
    await expect(page.getByText(/el saldo teorico cambio/)).toBeVisible();

    await page.getByRole('button', { name: 'Recargar la caja' }).click();
    await expect(dato(page, 'Deberia haber en el cajon')).toContainText('1.100,00');
    await expect(movimiento(page, `Ingreso desde otro puesto ${sufijo}`)).toHaveCount(1);

    // Arqueo con faltante: la diferencia se registra tal cual, pero exige motivo.
    await page.getByLabel('Efectivo contado').fill('1090');
    await expect(page.getByText(/Diferencia contra el teorico/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cerrar la caja' })).toBeDisabled();
    await page.getByLabel('Motivo de la diferencia').fill('Faltan 10 de cambio');
    await page.getByRole('button', { name: 'Cerrar la caja' }).click();

    await expect(page.getByRole('heading', { name: 'Arqueo registrado' })).toBeVisible();
    await expect(dato(page, 'Diferencia')).toContainText('Faltante de');
    await expect(dato(page, 'Diferencia')).toContainText('10,00');
    await expect(dato(page, 'Motivo')).toHaveText('Faltan 10 de cambio');
    await expect(page.getByRole('heading', { name: 'La caja esta cerrada' })).toBeVisible();
    expect(await cajaAbierta(api, centro)).toBeNull();
  });
});

test.describe('Cobro en efectivo de una sesion cerrada contra el backend real', () => {
  let profesional: ApiAkine;

  test.beforeAll(async ({ centro }) => {
    profesional = await comoProfesional(centro);
  });

  test.afterAll(async () => {
    await profesional.cerrar();
  });

  test.beforeEach(async ({ api, centro }) => {
    await dejarLaCajaCerrada(api, centro);
  });

  test('cierre de sesion → deuda → cobro en efectivo → movimiento en la caja', async ({
    page,
    api,
    centro,
  }) => {
    // Sesion cerrada por la API, como la profesional que atiende: es la que devenga la deuda.
    const oferta = await crearOferta(api, centro);
    await fijarPrecio(api, centro, oferta, 8500);
    const persona = await crearPersona(api);
    const { slots } = await diaDeTrabajo(api, centro, oferta.id, DIAS.cobro);
    const turno = await reservar(api, centro, oferta.id, persona.id, slots[0].desde);
    await cerrarSesionDelTurno(profesional, centro, turno.id);

    const [deuda] = await obligacionesDe(api, centro, persona.id);
    expect(deuda, 'el cierre de la sesion devengo la deuda del paciente').toBeDefined();
    expect(deuda.responsable).toBe('PACIENTE');
    expect(deuda.importeOriginal).toBe(8500);
    expect(deuda.estado).toBe('PENDIENTE');

    await ingresar(page, centro);
    await navegar(page, `/pacientes/${persona.id}/cuenta-corriente`);
    await expect(page.getByRole('heading', { name: 'Cuenta corriente', level: 1 })).toBeVisible();
    // La deuda se nombra por la sesion que la devengo ("Sesion 1"), no por la oferta.
    const filaDeuda = page
      .getByRole('region', { name: 'Deudas de la persona' })
      .getByRole('row')
      .filter({ hasText: 'Pendiente' });
    await expect(filaDeuda).toContainText('8.500,00');
    await expect(filaDeuda).toContainText('Pendiente');

    await page.getByRole('link', { name: 'Registrar un cobro' }).click();
    await expect(page.getByRole('heading', { name: 'Registrar un cobro', level: 1 })).toBeVisible();
    await page.getByRole('checkbox', { name: /saldo/ }).check();
    await page.getByLabel('Medio de pago').selectOption({ label: 'Efectivo' });
    await page.getByRole('button', { name: 'Completar con el total imputado' }).click();

    // Sin caja abierta, el efectivo no tiene cajon donde entrar: lo rechaza el servidor.
    const rechazo = respuestaDe(page, 'POST', /\/cobros$/);
    await page.getByRole('button', { name: 'Registrar el cobro' }).click();
    const sinCaja = await rechazo;
    expect(sinCaja.status()).toBe(409);
    expect((await problemaDe(sinCaja)).type).toBe(uriDeProblema('caja-no-abierta'));
    await expect(page.getByRole('heading', { name: 'No se registro el cobro' })).toBeVisible();
    await expect(page.getByText(/La caja de esta sede no esta abierta/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Recargar los saldos y volver a armar el cobro' }),
    ).toHaveCount(0);

    // La salida que ofrece la pantalla: ir a la caja, abrirla y volver a cobrar.
    await page.getByRole('link', { name: 'Ir a la caja' }).click();
    await expect(page.getByRole('heading', { name: 'La caja esta cerrada' })).toBeVisible();
    await page.getByLabel('Saldo inicial contado').fill('0');
    await page.getByRole('button', { name: 'Abrir la caja' }).click();
    await expect(page.getByRole('heading', { name: 'Caja abierta' })).toBeVisible();

    await navegar(page, `/pacientes/${persona.id}/cuenta-corriente/cobrar`);
    await page.getByRole('checkbox', { name: /saldo/ }).check();
    await page.getByLabel('Medio de pago').selectOption({ label: 'Efectivo' });
    await page.getByRole('button', { name: 'Completar con el total imputado' }).click();
    const alta = respuestaDe(page, 'POST', /\/cobros$/);
    await page.getByRole('button', { name: 'Registrar el cobro' }).click();
    const respuesta = await alta;
    expect(respuesta.status()).toBe(201);
    const cobro = (await respuesta.json()) as { id: number; comprobanteNumero: number };
    await expect(page.getByRole('heading', { name: 'Cobro registrado' })).toBeVisible();

    const [pagada] = await obligacionesDe(api, centro, persona.id);
    expect(pagada.estado).toBe('PAGADA');
    expect(pagada.saldo).toBe(0);

    // La caja lo muestra como ingreso de origen COBRO: no se revierte desde aca.
    await navegar(page, '/caja');
    await expect(page.getByRole('heading', { name: 'Caja abierta' })).toBeVisible();
    await expect(dato(page, 'Deberia haber en el cajon')).toContainText('8.500,00');
    const filaCobro = movimiento(page, `Cobro ${cobro.id}`);
    await expect(filaCobro).toContainText('Ingreso');
    await expect(filaCobro).toContainText('Efectivo');
    await expect(filaCobro).toContainText('+ $');
    await expect(filaCobro.getByRole('button', { name: 'Revertir' })).toHaveCount(0);

    await dejarLaCajaCerrada(api, centro);
  });
});
