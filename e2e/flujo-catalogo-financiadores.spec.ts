import { nonce } from './support/akine';
import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { fechaLocal } from './support/sembrado';
import { paginaDePlataforma, plataformaDisponible } from './support/sembrado-configuracion';

/**
 * E2E del catalogo global de financiadores (DP-43, U-12) contra el backend REAL, todo por pantalla:
 * la plataforma da de alta una obra social y su plan en su consola, y el centro la agrega desde
 * "Agregar desde el catalogo".
 *
 * <p>Lo que se afirma se relee del servidor: la copia es del centro (otro id, con `catalogoId`) y
 * lleva el plan; repetir la adopcion devuelve 200 con la MISMA copia (`creado = false`), y el
 * catalogo la marca "Ya agregado".
 */
test.describe('Catalogo global de financiadores contra el backend real', () => {
  test('la plataforma lo carga y el centro lo agrega por copia, una sola vez', async ({
    page,
    browser,
    api,
    centro,
  }) => {
    test.slow();
    const motivoPlataforma = await plataformaDisponible();
    test.skip(motivoPlataforma !== null, motivoPlataforma ?? '');

    const sufijo = nonce();
    const nombre = `Obra Social Catalogo ${sufijo}`;
    const codigo = `OSC${sufijo}`.slice(0, 20);

    // --- La plataforma carga la entrada y su plan ---------------------------------------------
    const plataforma = await paginaDePlataforma(browser);
    let catalogoId: number;
    try {
      await navegar(plataforma, '/plataforma/catalogo-financiadores');
      await expect(
        plataforma.getByRole('heading', { name: 'Catálogo de financiadores', level: 1 }),
      ).toBeVisible();
      await plataforma.getByRole('button', { name: 'Nuevo financiador' }).click();
      await plataforma.getByLabel('Código', { exact: true }).fill(codigo);
      await plataforma.getByLabel('Nombre', { exact: true }).fill(nombre);
      await plataforma.getByLabel('Tipo de financiador').selectOption({ value: 'OBRA_SOCIAL' });
      const alta = respuestaDe(plataforma, 'POST', /\/platform\/catalogo-financiadores$/);
      await plataforma.getByRole('button', { name: 'Guardar', exact: true }).click();
      const creada = await alta;
      expect(creada.status(), await creada.text()).toBe(201);
      catalogoId = ((await creada.json()) as { id: number }).id;
      await expect(plataforma.getByText(`${nombre} quedo en el catalogo`)).toBeVisible();

      await plataforma
        .getByRole('button', { name: `Agregar un plan a ${nombre}`, exact: true })
        .click();
      await plataforma.getByLabel('Código del plan').fill('PLAN-A');
      await plataforma.getByLabel('Nombre del plan').fill(`Plan A ${sufijo}`);
      await plataforma.getByLabel('Vigente desde').fill(fechaLocal(centro.timezone));
      const plan = respuestaDe(plataforma, 'POST', /\/catalogo-financiadores\/\d+\/planes$/);
      await plataforma.getByRole('button', { name: 'Guardar el plan' }).click();
      expect((await plan).status()).toBe(201);
      await expect(plataforma.getByRole('row').filter({ hasText: `Plan A ${sufijo}` })).toHaveCount(
        1,
      );
    } finally {
      await plataforma.context().close();
    }

    // --- El centro lo agrega desde su pantalla -------------------------------------------------
    await ingresar(page, centro);
    await navegar(page, '/contratacion/financiadores');
    await page.getByRole('link', { name: 'Agregar desde el catálogo' }).click();
    await expect(
      page.getByRole('heading', { name: 'Catálogo de financiadores', level: 1 }),
    ).toBeVisible();
    await page.getByLabel('Nombre, código o CUIT').fill(nombre);
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    const fila = page.getByRole('row').filter({ hasText: nombre });
    await expect(fila).toHaveCount(1);

    const adopcion = respuestaDe(
      page,
      'POST',
      new RegExp(`/catalogo-financiadores/${catalogoId}/adopcion$`),
    );
    await fila.getByRole('button', { name: `Agregar al centro ${nombre}` }).click();
    const respuesta = await adopcion;
    expect(respuesta.status(), await respuesta.text()).toBe(201);
    const { financiador, creado } = (await respuesta.json()) as {
      creado: boolean;
      financiador: { id: number; catalogoId: number };
    };
    expect(creado).toBe(true);
    expect(financiador.catalogoId).toBe(catalogoId);
    await expect(page).toHaveURL(
      new RegExp(`/contratacion/financiadores/${financiador.id}/planes$`),
    );
    await expect(page.getByRole('row').filter({ hasText: `Plan A ${sufijo}` })).toHaveCount(1);

    // La copia es del centro, y repetir la adopcion devuelve la MISMA copia con 200.
    const copia = await api.exigir<{ id: number; catalogoId: number; codigo: string }>(
      'GET',
      `/api/v1/financiadores/${financiador.id}`,
    );
    expect(copia.codigo).toBe(codigo);
    const repetida = await api.pedir(
      'POST',
      `/api/v1/catalogo-financiadores/${catalogoId}/adopcion`,
    );
    expect(repetida.status()).toBe(200);
    const otra = (await repetida.json()) as { creado: boolean; financiador: { id: number } };
    expect(otra.creado).toBe(false);
    expect(otra.financiador.id).toBe(financiador.id);

    // El catalogo ya la marca como agregada y enlaza a la copia.
    await navegar(page, '/contratacion/financiadores/catalogo');
    await page.getByLabel('Nombre, código o CUIT').fill(nombre);
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(fila.getByText('Ya agregado')).toBeVisible();
    await expect(fila.getByRole('link', { name: 'Ver la copia del centro' })).toHaveAttribute(
      'href',
      `/contratacion/financiadores/${financiador.id}/planes`,
    );

    // Y el listado del centro la marca "Del catalogo".
    await navegar(page, '/contratacion/financiadores');
    await page.getByLabel('Buscar', { exact: true }).fill(nombre);
    await page.getByLabel('Buscar', { exact: true }).press('Enter');
    await expect(
      page.getByRole('row', { name: new RegExp(nombre) }).getByText('Del catálogo'),
    ).toBeVisible();
  });
});
