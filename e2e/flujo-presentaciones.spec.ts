import { Locator, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { expect, ingresar, navegar, problemaDe, respuestaDe, test } from './support/agenda-real';
import {
  ApiAkine,
  Centro,
  DIAS,
  Obligacion,
  Persona,
  cerrarSesionDelTurno,
  comoProfesional,
  crearOferta,
  crearPersona,
  diaDeTrabajo,
  fechaLocal,
  obligacionesDe,
  reservar,
  sumarDias,
  uriDeProblema,
} from './support/sembrado';
import { nonce } from './support/akine';

/**
 * E2E de las presentaciones a financiadores (F-7, M21) contra el backend REAL: con una deuda a
 * cargo de una obra social, armar el borrador → agregar la prestacion → revisar → confirmar →
 * facturar → registrar el pago → cerrar (conciliar) el lote.
 *
 * <h2>De donde sale la deuda del financiador</h2>
 *
 * <p>Toda por la API y como la ADMINISTRADORA, salvo la sesion: financiador, plan, convenio de la
 * sede con su arancel para la practica principal de la oferta, y la cobertura FINANCIADA del
 * paciente. La oferta admite obra social. Al cerrar la sesion —como la profesional que atiende, la
 * unica con `sesion:register`— el devengado encuentra cobertura y arancel y deja DOS deudas: la del
 * financiador por `importeFinanciador` y el coseguro del paciente. No hace falta pasar por la
 * recepcion: solo "atender como Particular" cortaria el camino del financiador.
 *
 * <p>Todas las vigencias arrancan hace un mes: la deuda se devenga HOY (el instante del cierre) aunque
 * el turno sea futuro, y el periodo del lote tiene que contener hoy.
 */

const TOTAL = 12000;
const FINANCIADOR = 9600;
const COSEGURO = 2400;

interface Sembrado {
  readonly financiador: { readonly id: number; readonly nombre: string };
  readonly persona: Persona;
  readonly deFinanciador: Obligacion;
  readonly coseguro: Obligacion;
}

/** Practica global sembrada por V25 (catalogo de plataforma). */
async function practicaGlobal(api: ApiAkine, codigo: string): Promise<number> {
  const respuesta = await api.exigir<
    { id: number; codigo: string }[] | { content: { id: number; codigo: string }[] }
  >('GET', `/api/v1/catalogos/practicas?q=${codigo}`);
  const lista = Array.isArray(respuesta) ? respuesta : respuesta.content;
  const practica = lista.find((p) => p.codigo === codigo);
  expect(practica, `la practica global ${codigo} existe (V25)`).toBeDefined();
  return practica!.id;
}

async function sembrarDeudaDelFinanciador(
  api: ApiAkine,
  profesional: ApiAkine,
  centro: Centro,
): Promise<Sembrado> {
  const sufijo = nonce();
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

  const nombre = `Obra Social E2E ${sufijo}`;
  const financiador = await api.exigir<{ id: number }>('POST', '/api/v1/financiadores', {
    codigo: `OSE2E${sufijo}`.slice(0, 20),
    nombre,
    tipo: 'OBRA_SOCIAL',
  });
  const plan = await api.exigir<{ id: number }>(
    'POST',
    `/api/v1/financiadores/${financiador.id}/planes`,
    { codigo: `P${sufijo}`.slice(0, 20), nombre: `Plan E2E ${sufijo}`, vigenciaDesde: desde },
  );
  const convenio = await api.exigir<{ id: number }>('POST', `${sede}/convenios`, {
    financiadorId: financiador.id,
    planId: plan.id,
    codigo: `CV${sufijo}`.slice(0, 20),
    nombre: `Convenio E2E ${sufijo}`,
    modalidad: 'POR_PRESTACION',
    vigenciaDesde: desde,
    moneda: 'ARS',
  });
  await api.exigir('POST', `${sede}/convenios/${convenio.id}/aranceles`, {
    practicaId,
    importeTotal: TOTAL,
    importeFinanciador: FINANCIADOR,
    coseguro: COSEGURO,
    vigenciaDesde: desde,
  });

  const persona = await crearPersona(api);
  await api.exigir('POST', `/api/v1/personas/${persona.id}/coberturas`, {
    tipo: 'FINANCIADA',
    planId: plan.id,
    numeroAfiliado: `AF-${sufijo}`,
    vigenciaDesde: desde,
    principal: true,
  });

  const { slots } = await diaDeTrabajo(api, centro, oferta.id, DIAS.presentacion);
  const turno = await reservar(api, centro, oferta.id, persona.id, slots[0].desde);
  await cerrarSesionDelTurno(profesional, centro, turno.id);

  // La cuenta corriente del paciente lista SOLO lo que debe el paciente (el coseguro). La deuda del
  // financiador se lee de la bandeja de prestaciones elegibles, que es de donde la toma el lote.
  const hoy = fechaLocal(centro.timezone);
  const [coseguro] = await obligacionesDe(api, centro, persona.id);
  const elegibles = await api.exigir<Obligacion[]>(
    'GET',
    `${sede}/prestaciones-elegibles?financiadorId=${financiador.id}&desde=${sumarDias(hoy, -1)}&hasta=${sumarDias(hoy, 1)}`,
  );
  const deFinanciador = elegibles.find((d) => d.personaId === persona.id);
  const deudas = [coseguro, ...elegibles];
  expect(
    deFinanciador,
    `el cierre devengo la deuda del financiador: ${JSON.stringify(deudas)}`,
  ).toBeDefined();
  expect(deFinanciador!.importeOriginal).toBe(FINANCIADOR);
  expect(deFinanciador!.financiadorId).toBe(financiador.id);
  expect(coseguro?.concepto).toBe('COSEGURO');
  expect(coseguro?.importeOriginal).toBe(COSEGURO);

  return {
    financiador: { id: financiador.id, nombre },
    persona,
    deFinanciador: deFinanciador!,
    coseguro: coseguro!,
  };
}

/** El valor de una fila `<dt>`/`<dd>` del encabezado del lote. */
function dato(page: Page, termino: string): Locator {
  return page
    .locator('dt', { hasText: new RegExp(`^${termino}$`) })
    .locator('xpath=following-sibling::dd[1]');
}

test.describe('Presentaciones a financiadores contra el backend real', () => {
  let profesional: ApiAkine;

  test.beforeAll(async ({ centro }) => {
    profesional = await comoProfesional(centro);
  });

  test.afterAll(async () => {
    await profesional.cerrar();
  });

  test('borrador → agregar → revisar → confirmar → factura → pago → conciliar', async ({
    page,
    api,
    centro,
  }) => {
    test.slow();
    const sembrado = await sembrarDeudaDelFinanciador(api, profesional, centro);
    const hoy = fechaLocal(centro.timezone);
    const sede = `/api/v1/consultorios/${centro.consultorioId}`;

    await ingresar(page, centro);
    await navegar(page, '/presentaciones');
    await expect(
      page.getByRole('heading', { name: 'Presentaciones a financiadores', level: 1 }),
    ).toBeVisible();

    // El periodo es un filtro de la bandeja: un dia de cada lado cubre la fecha UTC del devengado.
    await page.locator('#alta-financiador').selectOption({ label: sembrado.financiador.nombre });
    await page.locator('#alta-desde').fill(sumarDias(hoy, -1));
    await page.locator('#alta-hasta').fill(sumarDias(hoy, 1));
    const alta = respuestaDe(page, 'POST', /\/presentaciones$/);
    await page.getByRole('button', { name: 'Abrir el borrador' }).click();
    expect((await alta).status()).toBe(201);

    await expect(
      page.getByRole('heading', { name: `Lote en borrador a ${sembrado.financiador.nombre}` }),
    ).toBeVisible();
    await expect(dato(page, 'Estado')).toHaveText('Borrador');
    const presentacionId = Number(new URL(page.url()).pathname.split('/').at(-1));

    // El coseguro es deuda del PACIENTE: el servidor no deja reclamarselo al financiador.
    const ajena = await api.pedir('POST', `${sede}/presentaciones/${presentacionId}/items`, {
      obligacionId: sembrado.coseguro.id,
    });
    expect(ajena.status(), await ajena.text()).toBe(409);
    expect(((await ajena.json()) as { type: string }).type).toBe(
      uriDeProblema('obligacion-no-presentable'),
    );

    // La bandeja ofrece solo la deuda del financiador, no el coseguro.
    const elegibles = page.getByRole('region', { name: 'Tabla de prestaciones elegibles' });
    await expect(
      elegibles.getByRole('row').filter({ hasText: `Persona #${sembrado.persona.id}` }),
    ).toHaveCount(1);
    await elegibles
      .getByRole('button', { name: `Agregar la deuda ${sembrado.deFinanciador.id}` })
      .click();
    await expect(page.getByText('Se agrego la prestacion al lote.')).toBeVisible();
    const items = page.getByRole('region', { name: 'Tabla de prestaciones del lote' });
    await expect(
      items.getByRole('row').filter({ hasText: `Persona #${sembrado.persona.id}` }),
    ).toContainText('9.600,00');

    await page.getByRole('button', { name: 'Volver a revisar' }).click();
    await expect(page.getByText('Ninguna prestacion tiene observaciones.')).toBeVisible();

    await page.getByRole('button', { name: 'Confirmar y presentar' }).click();
    await expect(page.getByText(/Lote presentado: tiene numero/)).toBeVisible();
    await expect(dato(page, 'Estado')).toHaveText('Presentada');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('N.º');
    await expect(dato(page, 'Presentado')).toContainText('9.600,00');

    // Cerrar con saldo pendiente lo rechaza el servidor: falta explicar 9.600.
    const rechazo = respuestaDe(page, 'POST', /\/conciliacion$/);
    await page.getByRole('button', { name: 'Cerrar (conciliar) el lote' }).click();
    const sinConciliar = await rechazo;
    expect(sinConciliar.status()).toBe(409);
    expect((await problemaDe(sinConciliar)).type).toBe(uriDeProblema('presentacion-no-concilia'));
    // Gana el `detail` del servidor, que dice cuanto falta.
    await expect(page.getByText(/9600.00 sin explicar/)).toBeVisible();

    await page.getByLabel('Numero de factura').fill(`0001-${sufijoDeFactura()}`);
    await page.getByRole('button', { name: 'Registrar la factura' }).click();
    await expect(page.getByText('Factura registrada.')).toBeVisible();
    await expect(dato(page, 'Estado')).toHaveText('Facturada');

    // Transferencia: un pago en efectivo entraria a la caja, que la opera `flujo-caja.spec.ts`.
    await page.locator('#pago-importe').fill(String(FINANCIADOR));
    await page.locator('#pago-medio').selectOption({ label: 'Transferencia' });
    await page.getByLabel('Referencia (opcional)').fill(`TRF-${presentacionId}`);
    await page.getByRole('button', { name: 'Registrar el pago' }).click();
    await expect(page.getByText(/Pago registrado\./)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pagos registrados' })).toBeVisible();
    await expect(dato(page, 'Saldo')).toContainText('0,00');

    await page.getByRole('button', { name: 'Cerrar (conciliar) el lote' }).click();
    await expect(page.getByText(/Lote cerrado\./)).toBeVisible();
    await expect(dato(page, 'Estado')).toHaveText('Conciliada');

    // Recien al conciliar se salda la deuda del financiador; el coseguro sigue siendo del paciente.
    const saldada = await api.exigir<Obligacion>(
      'GET',
      `${sede}/obligaciones/${sembrado.deFinanciador.id}`,
    );
    expect(saldada.estado).toBe('PAGADA');
    expect(saldada.saldo).toBe(0);
    const [coseguro] = await obligacionesDe(api, centro, sembrado.persona.id);
    expect(coseguro.id).toBe(sembrado.coseguro.id);
    expect(coseguro.estado).toBe('PENDIENTE');
  });
});

/** Numero de factura unico por corrida: el mismo numero dos veces es `factura-duplicada`. */
function sufijoDeFactura(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}
