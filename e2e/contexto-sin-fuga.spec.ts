import { expect, test } from '@playwright/test';

import {
  activarCuentaPorSql,
  darMembership,
  emailUnico,
  idDeCuenta,
  idDeOrganizacion,
  ingresarPorPantalla,
  nonce,
  registrarPorApi,
} from './support/akine';

/**
 * ESCENARIO 10 de `../appKine-api/docs/tests-diferidos.md` — cambio de contexto sin fuga.
 *
 * <p>Crear organizacion, seleccionar contexto, ver solo sus datos; cambiar a otra organizacion y
 * comprobar que NO queda ningun dato residual de la anterior en pantalla. `AGENT.md` 6 lo pide
 * explicitamente: "los datos de la Org A no pueden quedar en pantalla bajo la Org B".
 *
 * <p>Se difirio desde AKINE-01.01 porque sin login no habia forma de obtener un contexto.
 */

interface EscenarioDosOrganizaciones {
  readonly email: string;
  readonly centroA: string;
  readonly centroB: string;
}

/**
 * Monta una cuenta con DOS contextos.
 *
 * <p>El alta self-service crea una sola organizacion por cuenta, y las invitaciones son de
 * AKINE-01.03, asi que la segunda membership se SIEMBRA por SQL (declarado en `support/akine.ts`).
 * Todo lo demas —el alta, la activacion del circuito, el login, la seleccion— pasa por el backend.
 */
async function montarDosOrganizaciones(
  request: Parameters<typeof registrarPorApi>[0],
): Promise<EscenarioDosOrganizaciones> {
  const sufijo = nonce();
  const email = emailUnico('qa.contexto');
  const emailVecino = emailUnico('qa.contexto.vecino');
  const centroA = `Centro Alfa ${sufijo}`;
  const centroB = `Centro Beta ${sufijo}`;

  await registrarPorApi(request, { email, organizationName: centroA });
  await registrarPorApi(request, { email: emailVecino, organizationName: centroB });

  activarCuentaPorSql(email);
  darMembership(idDeCuenta(email), idDeOrganizacion(centroB));

  return { email, centroA, centroB };
}

test.describe('Escenario 10 - cambio de contexto sin fuga de datos', () => {
  test('con dos contextos habilitados, el selector los ofrece a los dos', async ({
    page,
    request,
  }) => {
    const { email, centroA, centroB } = await montarDosOrganizaciones(request);

    await ingresarPorPantalla(page, email);

    await expect(page).toHaveURL(/\/seleccionar-contexto/);
    await expect(page.getByRole('button', { name: centroA })).toBeVisible();
    await expect(page.getByRole('button', { name: centroB })).toBeVisible();
  });

  test('al cambiar de organizacion no queda ningun dato de la anterior en pantalla', async ({
    page,
    request,
  }) => {
    const { email, centroA, centroB } = await montarDosOrganizaciones(request);

    await ingresarPorPantalla(page, email);
    await expect(page).toHaveURL(/\/seleccionar-contexto/);

    // --- Contexto A: se ven SOLO los datos de A ---
    await page.getByRole('button', { name: centroA }).click();

    await expect(page).toHaveURL(/\/organizacion/);
    await expect(page.getByRole('heading', { name: 'Organizacion' })).toBeVisible();
    await expect(page.getByText(centroA, { exact: true })).toBeVisible();
    await expect(page.getByText(centroB, { exact: true })).toHaveCount(0);

    // --- Cambio a B: sin nuevo login, el token se renueva acotado a B (DP-02) ---
    await page.goto('/seleccionar-contexto');
    await page.getByRole('button', { name: centroB }).click();

    await expect(page).toHaveURL(/\/organizacion/);
    await expect(page.getByText(centroB, { exact: true })).toBeVisible();

    // El nucleo del escenario: CERO residuo de A en toda la pantalla, no solo en el titulo.
    await expect(page.getByText(centroA, { exact: true })).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain(centroA);

    // Y tampoco en la pantalla hermana, que cachea por su cuenta.
    await page.goto('/organizacion/suscripcion');
    // `exact` no es opcional: sin el, el locator tambien empareja el h3 "Suscripcion activa",
    // que aparece recien cuando termino de cargar. Sin `exact` el test pasa o falla segun el
    // momento en que corra la asercion, que es la definicion de un flake.
    await expect(page.getByRole('heading', { name: 'Suscripcion', exact: true })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(centroA);
  });

  test('la pantalla de organizacion muestra los datos del contexto elegido', async ({
    page,
    request,
  }) => {
    const { email, centroA } = await montarDosOrganizaciones(request);

    await ingresarPorPantalla(page, email);
    await page.getByRole('button', { name: centroA }).click();

    await expect(page.getByRole('heading', { name: 'Organizacion' })).toBeVisible();
    await expect(page.getByText(centroA, { exact: true })).toBeVisible();
    await expect(page.getByText('Zona horaria')).toBeVisible();
  });

  test('al elegir entre varios contextos no se afirma que hay uno solo', async ({
    page,
    request,
  }) => {
    const { email, centroA } = await montarDosOrganizaciones(request);

    await ingresarPorPantalla(page, email);
    await page.getByRole('button', { name: centroA }).click();

    await expect(page.getByText('Tenes un solo contexto habilitado')).toHaveCount(0);
  });

  test('sin contexto elegido, la pantalla de organizacion no muestra datos de ninguna organizacion', async ({
    page,
    request,
  }) => {
    const { email, centroA, centroB } = await montarDosOrganizaciones(request);

    await ingresarPorPantalla(page, email);
    await expect(page).toHaveURL(/\/seleccionar-contexto/);

    // URL directa, saltando el selector: el guard es UX, la autoridad es el backend. En ningun
    // caso puede aparecer el dato de una organizacion sobre la que no se declaro contexto.
    await page.goto('/organizacion');

    const texto = await page.locator('body').innerText();
    expect(texto, 'sin contexto no se puede filtrar el nombre de una organizacion').not.toContain(
      centroA,
    );
    expect(texto).not.toContain(centroB);
  });

  test('cerrar y volver a abrir la aplicacion no revive el contexto en una sesion anonima', async ({
    page,
    request,
  }) => {
    const { centroA, centroB } = await montarDosOrganizaciones(request);

    // Contexto de navegador limpio: nunca hubo login en esta pestania.
    await page.goto('/organizacion');

    const texto = await page.locator('body').innerText();
    expect(texto).not.toContain(centroA);
    expect(texto).not.toContain(centroB);
  });
});
