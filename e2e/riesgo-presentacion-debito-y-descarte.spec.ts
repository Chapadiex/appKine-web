import { Locator, Page, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { ingresar, navegar, respuestaDe } from './support/agenda-real';
import {
  CentroPropio,
  cerrarCentroPropio,
  dato,
  expect,
  sembrarCentroPropio,
} from './support/centro-propio';
import {
  Financiador,
  Obligacion,
  Persona,
  cerrarSesionDelTurno,
  crearConvenio,
  crearFinanciador,
  crearOferta,
  crearPersona,
  darCobertura,
  diaDeTrabajo,
  fechaLocal,
  practicaGlobal,
  reservarElPrimeroLibre,
  sumarDias,
  uriDeProblema,
} from './support/sembrado';

/**
 * E2E de lo que `flujo-presentaciones` no recorre de un lote al financiador (F-7, M21), contra el
 * backend real: quitar una prestacion del borrador, descartar el borrador, y el DEBITO de una
 * prestacion de un lote presentado.
 *
 * <p>Es plata reclamada a un tercero, y los tres caminos tienen una regla que un error rompe en
 * silencio:
 *
 * <ul>
 *   <li>quitar o descartar <b>libera</b> la deuda: vuelve a la bandeja de elegibles y no queda
 *       atrapada en un lote que nunca se va a presentar;</li>
 *   <li>un lote presentado no se descarta (es evidencia de lo reclamado): el servidor lo rechaza;</li>
 *   <li>el debito <b>no perdona</b> la deuda (RN-M21-004): al conciliar, la prestacion aceptada
 *       queda PAGADA y la debitada sigue PENDIENTE por el total y re-presentable. El debito
 *       PARCIAL deja hoy la deuda entera pendiente (U-11, conocido y aceptado): por eso el test
 *       debita el total, que es la regla que no depende de esa decision.</li>
 * </ul>
 *
 * <p>Centro propio (`support/centro-propio.ts`): el lote toma TODAS las deudas elegibles del
 * financiador en el periodo, y la conciliacion salda deudas del centro.
 */
test.describe.configure({ mode: 'default' });

const TOTAL = 12000;
const FINANCIADOR = 9600;
const COSEGURO = 2400;

interface Deuda {
  readonly persona: Persona;
  readonly obligacion: Obligacion;
}

test.describe('Debito, quitar y descartar en presentaciones contra el backend real', () => {
  let propio: CentroPropio;
  let financiador: Financiador;
  let aceptada: Deuda;
  let debitada: Deuda;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    propio = await sembrarCentroPropio('presentacion');
    const { api, profesional, centro } = propio;
    const desde = sumarDias(fechaLocal(centro.timezone), -30);
    const sede = `/api/v1/consultorios/${centro.consultorioId}`;

    const practicaId = await practicaGlobal(api, 'KIN_SESION');
    const oferta = await crearOferta(api, centro, {
      extra: { admiteObraSocial: true, precioBase: TOTAL, moneda: 'ARS' },
    });
    await api.exigir('PUT', `${sede}/ofertas/${oferta.id}/practicas`, {
      practicaIds: [practicaId],
      practicaPrincipalId: practicaId,
      expectedVersion: oferta.version,
    });
    financiador = await crearFinanciador(api, desde);
    const convenio = await crearConvenio(api, centro, financiador, desde);
    await api.exigir('POST', `${sede}/convenios/${convenio.id}/aranceles`, {
      practicaId,
      importeTotal: TOTAL,
      importeFinanciador: FINANCIADOR,
      coseguro: COSEGURO,
      vigenciaDesde: desde,
    });

    // Dos pacientes, una sesion cada uno: las filas del lote se distinguen por "Persona #id".
    const { slots } = await diaDeTrabajo(api, centro, oferta.id, 2);
    const deudas: Deuda[] = [];
    for (const [i, slot] of [slots[0], slots[1]].entries()) {
      const persona = await crearPersona(api, { nombre: i === 0 ? 'Acepta' : 'Debita' });
      await darCobertura(api, persona, financiador, desde);
      const turno = await reservarElPrimeroLibre(api, centro, oferta.id, persona.id, [slot]);
      await cerrarSesionDelTurno(profesional, centro, turno.id);
      const obligacion = (await elegibles(propio, financiador.id)).find(
        (o) => o.personaId === persona.id,
      );
      expect(
        obligacion,
        `el cierre devengo la deuda del financiador de ${persona.id}`,
      ).toBeDefined();
      expect(obligacion!.importeOriginal).toBe(FINANCIADOR);
      deudas.push({ persona, obligacion: obligacion! });
    }
    [aceptada, debitada] = deudas;
  });

  test.afterAll(async () => {
    await cerrarCentroPropio(propio);
  });

  test('quitar una prestacion y descartar el borrador las devuelven a la bandeja', async ({
    page,
  }) => {
    const { api, centro } = propio;
    await ingresar(page, centro);
    await abrirBorrador(page, propio, financiador);
    const presentacionId = idDeLaUrl(page);

    await agregar(page, aceptada);
    await agregar(page, debitada);
    await expect(filaDelLote(page, aceptada)).toContainText('9.600,00');
    await expect(filaDelLote(page, debitada)).toContainText('9.600,00');
    // Agregada, la deuda deja la bandeja: no se puede reclamar en dos lotes a la vez.
    await expect(filaElegible(page, debitada)).toHaveCount(0);

    // Quitar: vuelve a la bandeja en el acto.
    const quita = respuestaDe(page, 'DELETE', /\/presentaciones\/\d+\/items\/\d+$/);
    await filaDelLote(page, debitada).getByRole('button', { name: 'Quitar' }).click();
    expect((await quita).status()).toBeLessThan(300);
    await expect(
      page.getByText('Se quito la prestacion del lote. Vuelve a estar disponible.'),
    ).toBeVisible();
    await expect(filaDelLote(page, debitada)).toHaveCount(0);
    await expect(filaElegible(page, debitada)).toHaveCount(1);

    // Descartar con el motivo vacio no sale a la red: el motivo es obligatorio.
    await page.getByRole('button', { name: 'Descartar el borrador' }).click();
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    await expect(page.getByLabel('Motivo')).toHaveAttribute('aria-invalid', 'true');
    await page.getByLabel('Motivo').fill('Se armo con el periodo equivocado');
    const descarte = respuestaDe(page, 'POST', /\/presentaciones\/\d+\/anulacion$/);
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    expect((await descarte).status()).toBeLessThan(300);
    await expect(dato(page, 'Estado')).toHaveText('Anulada');
    await expect(page.getByText('Se armo con el periodo equivocado')).toBeVisible();

    // Las dos deudas estan otra vez disponibles para un lote nuevo.
    const disponibles = (await elegibles(propio, financiador.id)).map((o) => o.id);
    expect(disponibles).toEqual(
      expect.arrayContaining([aceptada.obligacion.id, debitada.obligacion.id]),
    );
    // Y el lote anulado ya no admite prestaciones.
    const tarde = await api.pedir(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/presentaciones/${presentacionId}/items`,
      { obligacionId: aceptada.obligacion.id },
    );
    expect(tarde.status(), await tarde.text()).toBe(409);
    expect(((await tarde.json()) as { type: string }).type).toBe(
      uriDeProblema('presentacion-no-editable'),
    );
  });

  test('el debito no perdona la deuda: al conciliar, la debitada sigue pendiente y re-presentable', async ({
    page,
  }) => {
    test.slow();
    const { api, centro } = propio;
    const sede = `/api/v1/consultorios/${centro.consultorioId}`;
    await ingresar(page, centro);
    await abrirBorrador(page, propio, financiador);
    const presentacionId = idDeLaUrl(page);
    await agregar(page, aceptada);
    await agregar(page, debitada);

    await page.getByRole('button', { name: 'Confirmar y presentar' }).click();
    await expect(page.getByText(/Lote presentado: tiene numero/)).toBeVisible();
    await expect(dato(page, 'Presentado')).toContainText('19.200,00');

    // Presentado, el lote es evidencia: no se descarta ni se le quitan prestaciones.
    await expect(page.getByRole('button', { name: 'Descartar el borrador' })).toHaveCount(0);
    await expect(filaDelLote(page, debitada).getByRole('button', { name: 'Quitar' })).toHaveCount(
      0,
    );
    const descarte = await api.pedir('POST', `${sede}/presentaciones/${presentacionId}/anulacion`, {
      motivo: 'Intento por fuera de la pantalla',
    });
    expect(descarte.status(), await descarte.text()).toBe(409);
    expect(((await descarte.json()) as { type: string }).type).toBe(
      uriDeProblema('presentacion-no-editable'),
    );

    // Debitar MAS de lo presentado lo rechaza el servidor, y el saldo del lote no se mueve.
    await filaDelLote(page, debitada).getByRole('button', { name: 'Registrar debito' }).click();
    await page.getByLabel('Importe debitado').fill('9601');
    await page.getByLabel('Motivo informado por el financiador').fill('Afiliado sin credencial');
    let rechazo = respuestaDe(page, 'POST', /\/items\/\d+\/debito$/);
    await page.getByRole('button', { name: 'Confirmar el debito' }).click();
    const excedido = await rechazo;
    expect(excedido.status()).toBe(400);
    const problemaExcedido = (await excedido.json()) as { type: string; importePresentado: number };
    expect(problemaExcedido.type).toBe(uriDeProblema('validation-error'));
    expect(problemaExcedido.importePresentado).toBe(FINANCIADOR);
    await expect(dato(page, 'Saldo')).toContainText('19.200,00');

    // Debito total de una prestacion.
    await page.getByLabel('Importe debitado').fill(String(FINANCIADOR));
    rechazo = respuestaDe(page, 'POST', /\/items\/\d+\/debito$/);
    await page.getByRole('button', { name: 'Confirmar el debito' }).click();
    expect((await rechazo).status()).toBeLessThan(300);
    await expect(page.getByText(/Debito registrado\./)).toBeVisible();
    await expect(filaDelLote(page, debitada)).toContainText('Debitada');
    await expect(filaDelLote(page, debitada)).toContainText('Debito: Afiliado sin credencial');
    await expect(dato(page, 'Saldo')).toContainText('9.600,00');

    // Un segundo debito sobre el mismo item: ya no es debitable.
    const lote = await api.exigir<{ items?: { id: number; personaId: number }[] }>(
      'GET',
      `${sede}/presentaciones/${presentacionId}`,
    );
    const lista = lote.items ?? [];
    const item = lista.find((i) => i.personaId === debitada.persona.id);
    expect(item, `el lote tiene el item de ${debitada.persona.id}`).toBeDefined();
    const doble = await api.pedir(
      'POST',
      `${sede}/presentaciones/${presentacionId}/items/${item!.id}/debito`,
      { importe: 1, motivo: 'Segundo debito' },
    );
    expect(doble.status(), await doble.text()).toBe(409);
    expect(((await doble.json()) as { type: string }).type).toBe(
      uriDeProblema('item-no-debitable'),
    );

    // Factura, pago por lo aceptado, conciliar.
    await page.getByLabel('Numero de factura').fill(`0001-${randomUUID().slice(0, 8)}`);
    await page.getByRole('button', { name: 'Registrar la factura' }).click();
    await expect(page.getByText('Factura registrada.')).toBeVisible();
    await page.locator('#pago-importe').fill(String(FINANCIADOR));
    await page.locator('#pago-medio').selectOption({ label: 'Transferencia' });
    await page.getByLabel('Referencia (opcional)').fill(`TRF-${presentacionId}`);
    await page.getByRole('button', { name: 'Registrar el pago' }).click();
    await expect(page.getByText(/Pago registrado\./)).toBeVisible();
    await expect(dato(page, 'Saldo')).toContainText('0,00');
    const cierre = respuestaDe(page, 'POST', /\/conciliacion$/);
    await page.getByRole('button', { name: 'Cerrar (conciliar) el lote' }).click();
    const conciliado = await cierre;
    expect(conciliado.status(), JSON.stringify(await conciliado.json())).toBeLessThan(300);
    await expect(dato(page, 'Estado')).toHaveText('Conciliada');

    // La aceptada se salda; la debitada sigue debiendose entera y vuelve a la bandeja.
    const pagada = await api.exigir<Obligacion>(
      'GET',
      `${sede}/obligaciones/${aceptada.obligacion.id}`,
    );
    expect(pagada.estado).toBe('PAGADA');
    expect(pagada.saldo).toBe(0);
    const pendiente = await api.exigir<Obligacion>(
      'GET',
      `${sede}/obligaciones/${debitada.obligacion.id}`,
    );
    expect(pendiente.estado).toBe('PENDIENTE');
    expect(pendiente.saldo).toBe(FINANCIADOR);
    const disponibles = (await elegibles(propio, financiador.id)).map((o) => o.id);
    expect(disponibles).toContain(debitada.obligacion.id);
    expect(disponibles).not.toContain(aceptada.obligacion.id);

    // Re-presentable: un borrador nuevo la ofrece en su bandeja.
    await navegar(page, '/presentaciones');
    await abrirBorrador(page, propio, financiador, false);
    await expect(filaElegible(page, debitada)).toHaveCount(1);
    await expect(filaElegible(page, aceptada)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------

/** La bandeja de prestaciones elegibles del financiador, un dia a cada lado de hoy. */
async function elegibles(propio: CentroPropio, financiadorId: number): Promise<Obligacion[]> {
  const { api, centro } = propio;
  const hoy = fechaLocal(centro.timezone);
  const periodo = `desde=${sumarDias(hoy, -1)}&hasta=${sumarDias(hoy, 1)}`;
  return api.exigir<Obligacion[]>(
    'GET',
    `/api/v1/consultorios/${centro.consultorioId}/prestaciones-elegibles?financiadorId=${financiadorId}&${periodo}`,
  );
}

async function abrirBorrador(
  page: Page,
  propio: CentroPropio,
  financiador: Financiador,
  navegarPrimero = true,
): Promise<void> {
  const hoy = fechaLocal(propio.centro.timezone);
  if (navegarPrimero) {
    await navegar(page, '/presentaciones');
  }
  await expect(
    page.getByRole('heading', { name: 'Presentaciones a financiadores', level: 1 }),
  ).toBeVisible();
  await page.locator('#alta-financiador').selectOption({ label: financiador.nombre });
  await page.locator('#alta-desde').fill(sumarDias(hoy, -1));
  await page.locator('#alta-hasta').fill(sumarDias(hoy, 1));
  const alta = respuestaDe(page, 'POST', /\/presentaciones$/);
  await page.getByRole('button', { name: 'Abrir el borrador' }).click();
  expect((await alta).status()).toBe(201);
  await expect(
    page.getByRole('heading', { name: `Lote en borrador a ${financiador.nombre}` }),
  ).toBeVisible();
}

function idDeLaUrl(page: Page): number {
  return Number(new URL(page.url()).pathname.split('/').at(-1));
}

function filaDelLote(page: Page, deuda: Deuda): Locator {
  return page
    .getByRole('region', { name: 'Tabla de prestaciones del lote' })
    .getByRole('row')
    .filter({ hasText: `Persona #${deuda.persona.id}` });
}

function filaElegible(page: Page, deuda: Deuda): Locator {
  return page
    .getByRole('region', { name: 'Tabla de prestaciones elegibles' })
    .getByRole('row')
    .filter({ hasText: `Persona #${deuda.persona.id}` });
}

async function agregar(page: Page, deuda: Deuda): Promise<void> {
  await filaElegible(page, deuda)
    .getByRole('button', { name: `Agregar la deuda ${deuda.obligacion.id}` })
    .click();
  await expect(filaDelLote(page, deuda)).toHaveCount(1);
}
