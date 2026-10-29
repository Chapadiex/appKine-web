import { Locator, Page } from '@playwright/test';

import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import {
  crearConvenio,
  crearFinanciador,
  crearOferta,
  fechaLocal,
  practicaGlobal,
  sumarDias,
} from './support/sembrado';

/**
 * E2E de dos pantallas de contratacion contra el backend REAL: las practicas que presta una oferta
 * (A-9, web #32) y la importacion masiva de aranceles de un convenio con vista previa (B-7, web #28).
 *
 * <p>Las practicas son las globales de V25 (`KIN_SESION`, `KIN_EVAL`): existen en toda base nueva y
 * no hace falta rol de plataforma para usarlas. El financiador, el plan y el convenio se siembran
 * por la API: tienen sus propias pantallas y no son lo que se prueba aca.
 */

interface PracticaDeOferta {
  readonly practicaId: number;
  readonly principal?: boolean;
  readonly estado?: string;
}

/** Busca una practica del catalogo por su codigo y la agrega a la seleccion. */
async function agregarPractica(page: Page, codigo: string): Promise<void> {
  await page.getByLabel('Buscar en el catalogo por nombre o código').fill(codigo);
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  const resultado = page
    .getByRole('region', { name: 'Agregar una práctica' })
    .getByRole('listitem')
    .filter({ hasText: codigo });
  await resultado.getByRole('button', { name: /^Agregar / }).click();
  await expect(resultado.getByRole('button')).toHaveText('Ya esta');
}

function declarada(page: Page, codigo: string): Locator {
  return page
    .getByRole('group', { name: 'Práctica principal' })
    .getByRole('listitem')
    .filter({ hasText: codigo });
}

test.describe('Practicas de una oferta contra el backend real', () => {
  test('agregar dos, elegir la principal, guardar y quitar una', async ({ page, api, centro }) => {
    const sede = `/api/v1/consultorios/${centro.consultorioId}`;
    const sesion = await practicaGlobal(api, 'KIN_SESION');
    const evaluacion = await practicaGlobal(api, 'KIN_EVAL');
    const oferta = await crearOferta(api, centro);

    await ingresar(page, centro);
    await navegar(page, `/servicios/ofertas/${oferta.id}/practicas`);
    await expect(
      page.getByRole('heading', { name: 'Prácticas de la oferta', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(/Sin prácticas, la oferta no le devenga nada/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Guardar las prácticas' })).toBeDisabled();

    await agregarPractica(page, 'KIN_SESION');
    await agregarPractica(page, 'KIN_EVAL');
    // La primera que entra queda como principal; se elige la otra.
    await expect(declarada(page, 'KIN_SESION')).toContainText('(principal)');
    await declarada(page, 'KIN_EVAL').getByRole('radio').check();
    await expect(declarada(page, 'KIN_EVAL')).toContainText('(principal)');

    const guardado = respuestaDe(page, 'PUT', /\/ofertas\/\d+\/practicas$/);
    await page.getByRole('button', { name: 'Guardar las prácticas' }).click();
    expect((await guardado).status()).toBe(200);
    await expect(
      page.getByRole('status').filter({ hasText: 'Guardamos las prácticas de la oferta.' }),
    ).toBeVisible();

    const leidas = await api.exigir<{ practicaPrincipalId: number; practicas: PracticaDeOferta[] }>(
      'GET',
      `${sede}/ofertas/${oferta.id}/practicas`,
    );
    expect(leidas.practicaPrincipalId).toBe(evaluacion);
    expect(
      leidas.practicas
        .filter((p) => p.estado !== 'INACTIVO')
        .map((p) => p.practicaId)
        .sort(),
    ).toEqual([sesion, evaluacion].sort());

    // Quitar la que no es principal: queda como historia en "Dadas de baja".
    await declarada(page, 'KIN_SESION')
      .getByRole('button', { name: /^Quitar / })
      .click();
    await page.getByRole('button', { name: 'Guardar las prácticas' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Guardamos las prácticas de la oferta.' }),
    ).toBeVisible();
    await expect(declarada(page, 'KIN_SESION')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Dadas de baja' })).toBeVisible();

    const despues = await api.exigir<{ practicaPrincipalId: number }>(
      'GET',
      `${sede}/ofertas/${oferta.id}/practicas`,
    );
    expect(despues.practicaPrincipalId).toBe(evaluacion);
  });
});

test.describe('Importacion de aranceles de un convenio contra el backend real', () => {
  test('la vista previa marca la fila que se pisa, y la confirmacion carga todo', async ({
    page,
    api,
    centro,
  }) => {
    const desde = sumarDias(fechaLocal(centro.timezone), -30);
    const financiador = await crearFinanciador(api, desde);
    const convenio = await crearConvenio(api, centro, financiador, desde);
    const encabezado = 'codigoPractica;importeTotal;importeFinanciador;coseguro;vigenciaDesde';
    const validas = [`KIN_SESION;12000;9600;2400;${desde}`, `KIN_EVAL;15000;12000;3000;${desde}`];
    // La misma practica dos veces con periodos que se cruzan.
    const pisada = `KIN_SESION;11000;8800;2200;${desde}`;

    await ingresar(page, centro);
    await navegar(page, `/contratacion/convenios/${convenio.id}/aranceles/importar`);
    await expect(
      page.getByRole('heading', { name: `Importar aranceles a ${convenio.nombre}`, level: 1 }),
    ).toBeVisible();

    const planilla = page.getByLabel('O pegala acá');
    await planilla.fill([encabezado, ...validas, pisada].join('\n'));
    await expect(page.getByText('3 filas listas para la vista previa.')).toBeVisible();

    const preview = respuestaDe(page, 'POST', /\/aranceles\/importacion$/);
    await page.getByRole('button', { name: 'Vista previa' }).click();
    expect((await preview).status()).toBe(200);
    const resultado = page.getByRole('region', { name: 'Resultado por fila' });
    await expect(page.getByText(/1 de 3 filas no entrarian/)).toBeVisible();
    const fila3 = resultado
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: /^3\b/ }) });
    await expect(fila3).toContainText('No entra');
    await expect(fila3).toContainText('Se pisa con la fila 1 de esta misma planilla');
    // Con una fila que no entra no se puede pasar a confirmar.
    await expect(page.getByRole('button', { name: 'Continuar' })).toBeDisabled();

    // Se vuelve al primer paso y se corrige la planilla: confirmar exige otra vista previa.
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.locator('ol.pasos li[aria-current="step"]')).toContainText('Cargar');
    await planilla.fill([encabezado, ...validas].join('\n'));
    await page.getByRole('button', { name: 'Vista previa' }).click();
    await expect(page.getByText(/Las 2 filas entran como aranceles nuevos/)).toBeVisible();

    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.locator('ol.pasos li[aria-current="step"]')).toContainText('Confirmar');
    const confirmacion = respuestaDe(page, 'POST', /\/aranceles\/importacion$/);
    await page.getByRole('button', { name: 'Confirmar 2 aranceles' }).click();
    expect((await confirmacion).status()).toBeLessThan(300);
    await expect(page).toHaveURL(
      new RegExp(`/contratacion/convenios/${convenio.id}/aranceles\\?.*importados=2`),
    );
    await expect(page.getByText(/Se importaron 2 aranceles/)).toBeVisible();

    const cargados = await api.exigir<unknown[] | { content: unknown[] }>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/convenios/${convenio.id}/aranceles`,
    );
    const lista = Array.isArray(cargados) ? cargados : cargados.content;
    expect(lista).toHaveLength(2);
  });
});
