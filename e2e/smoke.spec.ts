import { expect, test } from '@playwright/test';

/**
 * Smoke E2E del baseline (AKINE-00.01).
 *
 * Prueba lo unico que existe en esta etapa: que el stack completo se comunica de punta a
 * punta. No hay pantallas funcionales que ejercitar todavia.
 *
 * <p>Apunta a `/estado` y no a `/`: desde la etapa de navegacion la raiz redirige a la Agenda,
 * que exige sesion y contexto. El baseline tecnico se mudo a su propia URL y sigue siendo la
 * unica pantalla anonima que ejerce la cadena completa hasta MySQL.
 *
 * <p><b>Requiere el backend levantado</b> en http://localhost:8080 con su base.
 * Ver `playwright.config.ts`.
 */
test.describe('Baseline AKINE-00.01', () => {
  test('el shell carga y se conecta al backend a traves del proxy', async ({ page }) => {
    await page.goto('/estado');

    await expect(page.getByRole('heading', { name: 'Baseline tecnico', level: 1 })).toBeVisible();

    // Prueba la cadena completa: Angular -> cliente generado -> proxy -> Spring Boot -> MySQL.
    await expect(page.getByText('Conectado')).toBeVisible();
    await expect(page.getByText('akine-api')).toBeVisible();
  });

  test('el frontend consume la misma version de contrato que publica el backend', async ({
    page,
  }) => {
    await page.goto('/estado');
    await expect(page.getByText('Conectado')).toBeVisible();

    const publicado = await page.getByRole('definition').nth(2).textContent();
    const consumido = await page.getByRole('definition').nth(3).textContent();

    expect(publicado?.trim()).toBe(consumido?.trim());
  });

  test('el skip link lleva al contenido principal con el teclado', async ({ page }) => {
    await page.goto('/estado');

    // Anclar el foco al inicio del documento ANTES de tabular.
    //
    // Sin esto el test dependia de cuantos Tab hacen falta para entrar al documento, que no es
    // una propiedad de la aplicacion sino del entorno: si la ventana no tiene el foco del
    // sistema operativo los primeros Tab se los come el chrome del navegador y el skip link
    // recibe el foco recien en el tercero. Poniendo `document.body` como elemento activo, la
    // navegacion secuencial arranca siempre desde el principio del documento y un unico Tab
    // tiene que caer en el primer elemento enfocable.
    await page.locator('body').focus();
    await expect(page.locator('body')).toBeFocused();

    // Primer Tab desde el inicio del documento: debe caer en el skip link.
    await page.keyboard.press('Tab');

    const skipLink = page.getByRole('link', { name: 'Saltar al contenido principal' });
    await expect(skipLink).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.locator('#contenido')).toBeFocused();
  });

  test('el health del backend responde a traves del proxy', async ({ request }) => {
    const respuesta = await request.get('/actuator/health');

    expect(respuesta.ok()).toBeTruthy();
    expect(await respuesta.text()).toContain('UP');
  });

  test('el backend rechaza una ruta inexistente sin filtrar detalles internos', async ({
    request,
  }) => {
    const respuesta = await request.get('/api/v1/no-existe');

    expect(respuesta.status()).toBeGreaterThanOrEqual(400);

    const cuerpo = await respuesta.text();
    // El error nunca puede exponer stack traces ni nombres de clase internos.
    expect(cuerpo).not.toContain('com.akine');
    expect(cuerpo).not.toContain('org.springframework');
    expect(cuerpo.toLowerCase()).not.toContain('stacktrace');
  });
});

test.describe('Estructura de rutas (AKINE-00.02)', () => {
  test('una ruta inexistente muestra la pagina 404 con salida', async ({ page }) => {
    await page.goto('/no-existe-esta-ruta');

    await expect(page.getByRole('heading', { name: 'Pagina no encontrada' })).toBeVisible();
    // El error se anuncia por lector de pantalla, no solo visualmente (ADR-0005).
    await expect(page.getByRole('alert')).toBeVisible();

    // Y ofrece una salida: un cartel sin accion deja al usuario sin nada que hacer.
    // 'Volver al inicio' apunta a `/`, que ahora redirige a la Agenda; sin sesion eso termina
    // en el login. Lo que este test pinea es que la salida EXISTE y lleva a algun lado, no a
    // cual: el destino de la raiz lo pinea `app.routes.spec.ts`.
    await page.getByRole('link', { name: 'Volver al inicio' }).click();
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Pagina no encontrada');
  });

  test('el layout persiste al cambiar de ruta', async ({ page }) => {
    await page.goto('/estado');
    await expect(page.getByRole('banner')).toBeVisible();

    await page.goto('/no-existe-esta-ruta');
    // La cabecera y el skip link viven en el layout, no en la pagina: sobreviven a la
    // navegacion sin que cada pagina tenga que reimplementarlos.
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Saltar al contenido principal' })).toBeAttached();
  });
});
