import { Page, test } from '@playwright/test';

import { nonce } from './support/akine';
import { ingresar, navegar, respuestaDe } from './support/agenda-real';
import {
  CentroPropio,
  cerrarCentroPropio,
  expect,
  sembrarCentroPropio,
} from './support/centro-propio';
import { esperarProblema } from './support/cuentas';
import { instanteEnZona } from './support/sembrado-asistencia';
import { fechaLocal, practicaGlobal, sumarDias } from './support/sembrado';
import { abrirFiltros } from './support/filtros';

/**
 * E2E de `/catalogo/nomencladores/:id/vigencias` (M06, RN-M06-002) contra el backend REAL.
 *
 * <p>Un nomenclador PROPIO de la organizacion —los de la plataforma no se administran desde aca—
 * sembrado por la API sobre un centro propio (`support/centro-propio.ts`), y todo lo demas por
 * pantalla: cargar dos vigencias del mismo codigo una detras de otra, chocar con la tercera que las
 * pisa (`nomenclador-vigencia-overlap`, que la pantalla muestra en el campo del codigo), y dar de
 * baja la vieja con motivo.
 *
 * <p>Las fechas son `datetime-local` y la pantalla las interpreta en la zona de la SEDE, no en la
 * del navegador (que corre a proposito en otra, ver `playwright.config.ts`): el spec afirma el
 * instante que viajo contra el que corresponde a esa hora en la zona de la sede.
 */
test.describe.configure({ mode: 'default' });

interface Vigencia {
  readonly id: number;
  readonly codigo: string;
  readonly practicaId: number;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly estado: string;
  readonly vigente?: boolean;
  readonly deactivationReason?: string;
}

const filaDe = (page: Page, nombre: string) =>
  page
    .getByRole('region', { name: 'Vigencias del nomenclador' })
    .getByRole('row')
    .filter({ hasText: nombre });

async function cargarVigencia(
  page: Page,
  datos: {
    codigo: string;
    nombre: string;
    practicaId: number;
    valor?: string;
    desde: string;
    hasta?: string;
  },
) {
  await page.getByRole('button', { name: 'Cargar una vigencia' }).click();
  await page.getByLabel('Código', { exact: true }).fill(datos.codigo);
  await page.getByLabel('Práctica que codifica').selectOption(String(datos.practicaId));
  await page.getByLabel('Nombre', { exact: true }).fill(datos.nombre);
  if (datos.valor !== undefined) {
    await page.getByLabel('Valor de referencia (opcional)').fill(datos.valor);
  }
  await page.getByLabel('Vigente desde (opcional)').fill(datos.desde);
  if (datos.hasta !== undefined) {
    await page.getByLabel('Vigente hasta (opcional)').fill(datos.hasta);
  }
  const alta = respuestaDe(page, 'POST', /\/catalogos\/nomencladores\/\d+\/items$/);
  await page.getByRole('button', { name: 'Cargar la vigencia' }).click();
  return alta;
}

test.describe('Vigencias de un nomenclador contra el backend real', () => {
  let propio: CentroPropio;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    propio = await sembrarCentroPropio('vigencias');
  });

  test.afterAll(async () => {
    await cerrarCentroPropio(propio);
  });

  test('cargar dos vigencias seguidas, chocar con una que las pisa y dar de baja la vieja', async ({
    page,
  }) => {
    const { api, centro } = propio;
    const zona = centro.timezone;
    const sufijo = nonce();
    const codigo = `25.01.${sufijo.slice(0, 4)}`;
    const practicaId = await practicaGlobal(api, 'KIN_SESION');
    const nomenclador = await api.exigir<{ id: number; name: string }>(
      'POST',
      '/api/v1/catalogos/nomencladores',
      { codigo: `NOM-${sufijo}`, name: `Nomenclador E2E ${sufijo}`, alcance: 'ORGANIZACION' },
    );

    const hoy = fechaLocal(zona);
    const viejaDesde = sumarDias(hoy, -200);
    const viejaHasta = sumarDias(hoy, -101);
    const nuevaDesde = sumarDias(hoy, -100);

    await ingresar(page, centro);
    await navegar(page, `/catalogo/nomencladores/${nomenclador.id}/vigencias`);
    await expect(page.getByRole('heading', { name: nomenclador.name, level: 2 })).toBeVisible();
    await expect(page.getByText(`Codigo NOM-${sufijo}`)).toBeVisible();
    await expect(
      page.getByText('Este nomenclador todavía no tiene vigencias con el filtro elegido.'),
    ).toBeVisible();

    // --- La vieja: una ventana que ya termino ------------------------------------------------
    const vieja = await cargarVigencia(page, {
      codigo,
      nombre: `Sesion vieja ${sufijo}`,
      practicaId,
      valor: '1500.50',
      desde: `${viejaDesde}T00:00`,
      hasta: `${viejaHasta}T23:59`,
    });
    expect(vieja.status(), await vieja.text()).toBe(201);
    const creadaVieja = (await vieja.json()) as Vigencia;
    expect(Date.parse(creadaVieja.validFrom!)).toBe(
      Date.parse(instanteEnZona(viejaDesde, '00:00', zona)),
    );
    expect(Date.parse(creadaVieja.validUntil!)).toBe(
      Date.parse(instanteEnZona(viejaHasta, '23:59', zona)),
    );
    await expect(filaDe(page, `Sesion vieja ${sufijo}`)).toContainText('Activa, fuera de ventana');
    await expect(filaDe(page, `Sesion vieja ${sufijo}`)).toContainText('1500.5');

    // --- La nueva: mismo codigo, empieza despues y rige hoy ---------------------------------
    const nueva = await cargarVigencia(page, {
      codigo,
      nombre: `Sesion nueva ${sufijo}`,
      practicaId,
      desde: `${nuevaDesde}T08:30`,
    });
    expect(nueva.status(), await nueva.text()).toBe(201);
    const creadaNueva = (await nueva.json()) as Vigencia;
    expect(Date.parse(creadaNueva.validFrom!)).toBe(
      Date.parse(instanteEnZona(nuevaDesde, '08:30', zona)),
    );
    expect(creadaNueva.validUntil).toBeUndefined();
    await expect(filaDe(page, `Sesion nueva ${sufijo}`)).toContainText('Rige hoy');
    await expect(filaDe(page, `Sesion nueva ${sufijo}`)).toContainText('Sin valor');

    // --- Una tercera que pisa a las dos: la rechaza el servidor -----------------------------
    const pisada = await cargarVigencia(page, {
      codigo,
      nombre: `Sesion pisada ${sufijo}`,
      practicaId,
      desde: `${sumarDias(hoy, -150)}T00:00`,
    });
    await esperarProblema(pisada, 409, 'https://akine.app/problems/nomenclador-vigencia-overlap');
    await expect(page.getByLabel('Código', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(
      page.locator('.campo__error[role="alert"]').filter({ hasText: /./ }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(filaDe(page, `Sesion pisada ${sufijo}`)).toHaveCount(0);

    // --- Dar de baja la vieja con motivo -----------------------------------------------------
    const motivo = `Reemplazada por la del nomenclador ${sufijo}`;
    await filaDe(page, `Sesion vieja ${sufijo}`)
      .getByRole('button', { name: 'Dar de baja' })
      .click();
    await page.getByLabel('Motivo de la baja').fill(motivo);
    const baja = respuestaDe(page, 'POST', /\/items\/\d+\/deactivate$/);
    await page.getByRole('button', { name: 'Dar de baja', exact: true }).last().click();
    expect((await baja).status(), await (await baja).text()).toBeLessThan(300);
    await expect(filaDe(page, `Sesion vieja ${sufijo}`)).toHaveCount(0);
    await expect(filaDe(page, `Sesion nueva ${sufijo}`)).toContainText('Rige hoy');

    await abrirFiltros(page);
    await page.getByLabel('Mostrar').selectOption({ label: 'Solo las dadas de baja' });
    await expect(filaDe(page, `Sesion vieja ${sufijo}`)).toContainText('Dada de baja');
    await expect(filaDe(page, `Sesion vieja ${sufijo}`)).toContainText(motivo);

    // --- El filtro por codigo muestra la historia completa del codigo -----------------------
    await page.getByLabel('Mostrar').selectOption({ label: 'Todas' });
    await page.getByLabel('Filtrar por código').fill(codigo);
    await page.getByLabel('Filtrar por código').press('Enter');
    await expect(
      page.getByRole('region', { name: 'Vigencias del nomenclador' }).locator('tbody > tr'),
    ).toHaveCount(2);

    const enElServidor = await api.exigir<Vigencia[]>(
      'GET',
      `/api/v1/catalogos/nomencladores/${nomenclador.id}/items?estado=TODOS&codigo=${encodeURIComponent(codigo)}`,
    );
    expect(enElServidor).toHaveLength(2);
    expect(enElServidor.find((v) => v.id === creadaVieja.id)).toMatchObject({
      estado: 'INACTIVO',
      deactivationReason: motivo,
    });
    expect(enElServidor.find((v) => v.id === creadaNueva.id)).toMatchObject({
      estado: 'ACTIVO',
      vigente: true,
      practicaId,
    });
  });
});
