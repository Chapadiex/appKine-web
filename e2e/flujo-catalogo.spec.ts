import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { nonce } from './support/akine';
import { abrirFiltros } from './support/filtros';

/**
 * E2E del catalogo clinico (M06, AKINE-02.05) contra el backend REAL: alta de un concepto propio
 * del centro. El pedido de conceptos a la plataforma salio del frontend el 11/11/2026.
 */
test.describe('Catalogo clinico contra el backend real', () => {
  test.beforeEach(async ({ page, centro }) => {
    await ingresar(page, centro);
  });

  test('alta de una especialidad propia del centro', async ({ page }) => {
    const sufijo = nonce();
    const nombre = `Especialidad propia ${sufijo}`;

    await navegar(page, '/catalogo/especialidades');
    await expect(page.getByRole('heading', { name: 'Catálogo clínico', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Dar de alta una especialidad de este centro' }).click();
    await page.getByLabel('Código', { exact: true }).fill(`E2E_PROPIA_${sufijo}`);
    await page.getByLabel('Nombre', { exact: true }).fill(nombre);
    const alta = respuestaDe(page, 'POST', /\/catalogos\/especialidades$/);
    await page.getByRole('button', { name: 'Dar de alta', exact: true }).click();
    const creada = await alta;
    expect(creada.status(), await creada.text()).toBe(201);
    expect(((await creada.json()) as { organizationId?: number }).organizationId).toBeDefined();
    await expect(
      page
        .getByRole('region', { name: 'Notificaciones', exact: true })
        .getByText('Concepto agregado al catálogo del centro'),
    ).toBeVisible();

    await abrirFiltros(page);
    await page.getByLabel('De quien').selectOption('ORGANIZACION');
    await page.getByLabel('Buscar').fill(nombre);
    await expect(page.getByRole('row').filter({ hasText: nombre })).toBeVisible();

    // Es del centro y no de la plataforma: el filtro de los globales no la trae.
    await page.getByLabel('De quien').selectOption('GLOBAL');
    await expect(page.getByRole('row').filter({ hasText: nombre })).toHaveCount(0);
  });
});
