import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { nonce } from './support/akine';
import { paginaDePlataforma, plataformaDisponible } from './support/sembrado-configuracion';

/**
 * E2E del catalogo clinico (M06, AKINE-02.05 y A-7) contra el backend REAL: alta de un concepto
 * propio del centro, y el pedido de un concepto al catalogo comun que la plataforma aprueba desde
 * su consola.
 *
 * <p>RF-M06-005 no cerraba de punta a punta: el centro podia pedir, pero resolver el pedido no
 * tenia pantalla. A-7 la agrego (`/plataforma/solicitudes`) y ningun test la habia recorrido contra
 * el servidor: el ida y vuelta entero —pedido, aprobacion, el centro lo ve aprobado y el concepto
 * aparece entre los de la plataforma— es lo que se prueba aca.
 *
 * <p>La aprobacion necesita la cuenta de plataforma del bootstrap de DP-14 (ver `docs/e2e-ci.md`).
 * Si la base no la tiene, ese test se saltea diciendo por que.
 */
test.describe('Catalogo clinico contra el backend real', () => {
  test.beforeEach(async ({ page, centro }) => {
    await ingresar(page, centro);
  });

  test('alta de una especialidad propia del centro', async ({ page }) => {
    const sufijo = nonce();
    const nombre = `Especialidad propia ${sufijo}`;

    await navegar(page, '/catalogo/especialidades');
    await expect(page.getByRole('heading', { name: 'Especialidades', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Dar de alta una especialidad de este centro' }).click();
    await page.getByLabel('Codigo', { exact: true }).fill(`E2E_PROPIA_${sufijo}`);
    await page.getByLabel('Nombre', { exact: true }).fill(nombre);
    const alta = respuestaDe(page, 'POST', /\/catalogos\/especialidades$/);
    await page.getByRole('button', { name: 'Dar de alta', exact: true }).click();
    const creada = await alta;
    expect(creada.status(), await creada.text()).toBe(201);
    expect(((await creada.json()) as { organizationId?: number }).organizationId).toBeDefined();
    await expect(
      page.getByText('La especialidad quedo dada de alta para este centro.'),
    ).toBeVisible();

    await page.getByLabel('De quien').selectOption('ORGANIZACION');
    await page.getByLabel('Buscar').fill(nombre);
    await expect(page.getByRole('row').filter({ hasText: nombre })).toBeVisible();

    // Es del centro y no de la plataforma: el filtro de los globales no la trae.
    await page.getByLabel('De quien').selectOption('GLOBAL');
    await expect(page.getByRole('row').filter({ hasText: nombre })).toHaveCount(0);
  });

  test('pedido al catalogo comun, aprobado por la plataforma y visto por el centro', async ({
    page,
    browser,
  }) => {
    const motivo = await plataformaDisponible();
    test.skip(motivo !== null, motivo ?? '');

    const sufijo = nonce();
    const nombre = `Especialidad pedida ${sufijo}`;

    // --- El centro pide ---
    await navegar(page, '/catalogo/solicitudes');
    await page.getByRole('button', { name: 'Pedir un concepto a la plataforma' }).click();
    await page.getByLabel('Que tipo de concepto').selectOption('ESPECIALIDAD');
    await page.getByLabel('Nombre propuesto').fill(nombre);
    await page.getByLabel('Codigo propuesto (opcional)').fill(`E2E_PEDIDA_${sufijo}`);
    await page
      .getByLabel('Por que deberia estar en el catalogo comun')
      .fill('La usan todos los centros de la red y hoy cada uno la carga por su cuenta.');
    const pedido = respuestaDe(page, 'POST', /\/catalogo-solicitudes$/);
    await page.getByRole('button', { name: 'Enviar el pedido' }).click();
    expect((await pedido).status()).toBe(201);
    const filaDelCentro = page.getByRole('row').filter({ hasText: nombre });
    await expect(filaDelCentro.getByText('Pendiente', { exact: true })).toBeVisible();

    // --- La plataforma lo aprueba desde su consola ---
    const plataforma = await paginaDePlataforma(browser);
    try {
      await navegar(plataforma, '/plataforma/solicitudes');
      await expect(
        plataforma.getByRole('heading', { name: 'Solicitudes de catalogo', level: 1 }),
      ).toBeVisible();
      await plataforma.getByRole('button', { name: `Revisar ${nombre}` }).click();
      await plataforma.getByRole('button', { name: 'Aprobar y publicar' }).click();
      await expect(plataforma.getByLabel('Codigo con el que se publica')).toHaveValue(
        `E2E_PEDIDA_${sufijo}`,
      );
      await expect(plataforma.getByLabel('Nombre con el que se publica')).toHaveValue(nombre);
      await plataforma.getByLabel('Nota para el centro').fill('Publicada para toda la red.');
      const resolucion = respuestaDe(plataforma, 'POST', /\/catalogo-solicitudes\/\d+\/resolve$/);
      await plataforma.getByRole('button', { name: 'Aprobar y publicar' }).click();
      expect((await resolucion).status()).toBe(200);
      await expect(
        plataforma.getByText(`Aprobada: "${nombre}" ya esta publicado en el catalogo comun`),
      ).toBeVisible();
    } finally {
      await plataforma.context().close();
    }

    // --- El centro lo ve aprobado, y el concepto ya es de la plataforma ---
    // Se sale y se vuelve para que la pantalla relea: dos `navegar` seguidos sin esperar dejan al
    // router cancelar el primero y tomar el segundo como "misma URL", que no recarga nada.
    await navegar(page, '/catalogo/especialidades');
    await expect(page.getByRole('heading', { name: 'Especialidades', level: 1 })).toBeVisible();
    const relectura = page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        new URL(r.url()).pathname.endsWith('/catalogo-solicitudes'),
    );
    await navegar(page, '/catalogo/solicitudes');
    expect((await relectura).status()).toBe(200);
    const aprobada = page.getByRole('row').filter({ hasText: nombre });
    await expect(aprobada.getByText('Aprobada', { exact: true })).toBeVisible();
    await expect(aprobada.getByText('Publicada para toda la red.')).toBeVisible();

    await navegar(page, '/catalogo/especialidades');
    await page.getByLabel('De quien').selectOption('GLOBAL');
    await page.getByLabel('Buscar').fill(nombre);
    await expect(page.getByRole('row').filter({ hasText: nombre })).toBeVisible();
  });
});
