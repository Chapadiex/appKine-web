import { expect, test } from '@playwright/test';

import {
  PASSWORD,
  activarCuentaPorSql,
  esperarCupoDeRegistro,
  campo,
  emailUnico,
  esperarSinInternals,
  estadoDeCuenta,
  ingresarPorPantalla,
  nonce,
} from './support/akine';

/**
 * Flujo que AKINE-01.02 vino a habilitar: registro -> login -> seleccion de contexto,
 * mas el pedido de restablecimiento de contrasena.
 *
 * <p>Contra el stack real (MySQL + Spring Boot + Angular). Requiere el backend levantado; ver
 * `playwright.config.ts`.
 *
 * <p><b>Tramo NO cubierto: la activacion por enlace.</b> Ver `support/akine.ts`,
 * `activarCuentaPorSql`.
 */
test.describe('Registro, activacion y login (M02)', () => {
  test('el alta self-service por pantalla crea la cuenta PENDIENTE_ACTIVACION', async ({
    page,
  }) => {
    const email = emailUnico('qa.registro');
    const centro = `Centro Registro ${nonce()}`;

    await page.goto('/auth/registro');

    await campo(page, 'Nombre', { exact: true }).fill('Ana');
    await campo(page, 'Apellido').fill('Prueba');
    await campo(page, 'Email').fill(email);
    await campo(page, 'Contrasena').fill(PASSWORD);
    await campo(page, 'Nombre del centro').fill(centro);

    await esperarCupoDeRegistro();
    await page.getByRole('button', { name: 'Crear la cuenta' }).click();

    await expect(page.getByText('Listo, ya lo estamos procesando.')).toBeVisible();

    // La respuesta es uniforme (ADR-0018): la pantalla no puede decir si el email era nuevo.
    // Lo unico que prueba que el alta ocurrio de verdad es la base.
    await expect(() => {
      expect(estadoDeCuenta(email)).toBe('PENDIENTE_ACTIVACION');
    }).toPass({ timeout: 10_000 });
  });

  test('una cuenta sin activar no puede iniciar sesion, y el rechazo es el mismo que el de credenciales malas', async ({
    page,
  }) => {
    const email = emailUnico('qa.sinactivar');

    await page.goto('/auth/registro');
    await campo(page, 'Nombre', { exact: true }).fill('Ana');
    await campo(page, 'Apellido').fill('Prueba');
    await campo(page, 'Email').fill(email);
    await campo(page, 'Contrasena').fill(PASSWORD);
    await campo(page, 'Nombre del centro').fill(`Centro Sin Activar ${nonce()}`);
    await esperarCupoDeRegistro();
    await page.getByRole('button', { name: 'Crear la cuenta' }).click();
    await expect(page.getByText('Listo, ya lo estamos procesando.')).toBeVisible();

    await ingresarPorPantalla(page, email);

    const errorSinActivar = page.getByRole('alert');
    await expect(errorSinActivar).toBeVisible();
    const mensajeSinActivar = (await errorSinActivar.textContent())?.trim() ?? '';

    // Mismo mensaje que una contrasena incorrecta: si difirieran, el login seria un
    // verificador de emails registrados (ADR-0018).
    await page.goto('/auth/ingresar');
    await campo(page, 'Email').fill(emailUnico('qa.inexistente'));
    await campo(page, 'Contrasena').fill(PASSWORD);
    await page.getByRole('button', { name: 'Iniciar sesion' }).click();

    const errorInexistente = page.getByRole('alert');
    await expect(errorInexistente).toBeVisible();
    expect((await errorInexistente.textContent())?.trim()).toBe(mensajeSinActivar);

    await expect(page).toHaveURL(/\/auth\/ingresar/);
  });

  test('registro -> (activacion sembrada) -> login -> queda en el selector de contexto', async ({
    page,
  }) => {
    const email = emailUnico('qa.login');
    const centro = `Centro Login ${nonce()}`;

    await page.goto('/auth/registro');
    await campo(page, 'Nombre', { exact: true }).fill('Ana');
    await campo(page, 'Apellido').fill('Prueba');
    await campo(page, 'Email').fill(email);
    await campo(page, 'Contrasena').fill(PASSWORD);
    await campo(page, 'Nombre del centro').fill(centro);
    await esperarCupoDeRegistro();
    await page.getByRole('button', { name: 'Crear la cuenta' }).click();
    await expect(page.getByText('Listo, ya lo estamos procesando.')).toBeVisible();

    await expect(() => {
      expect(estadoDeCuenta(email)).toBe('PENDIENTE_ACTIVACION');
    }).toPass({ timeout: 10_000 });

    // SEMBRADO DECLARADO: el enlace de activacion no es recuperable desde afuera.
    activarCuentaPorSql(email);

    await ingresarPorPantalla(page, email);

    // Con un solo contexto el selector no pregunta: entra solo.
    //
    // Se afirma el DESTINO y no el "Entrando a ..." intermedio. Ese cartel existe, pero el
    // router lo reemplaza en cientos de milisegundos, asi que una asercion sobre el pierde la
    // carrera casi siempre y falla por un motivo que no tiene que ver con lo que el test
    // quiere probar. El estado transitorio ya esta cubierto de forma determinista en
    // `context-selector-page.spec.ts`; lo que solo se puede verificar de punta a punta es que
    // el canje de contexto ocurrio y dejo al usuario adentro con los datos de su centro.
    await expect(page).toHaveURL(/\/organizacion/);
    // `exact`: desde la navegacion principal el nombre del centro aparece tambien en la cabecera,
    // como "· <centro>", y sin `exact` el localizador choca en modo estricto.
    await expect(page.getByText(centro, { exact: true })).toBeVisible();
  });

  test('el pedido de restablecimiento responde igual exista o no la cuenta', async ({ page }) => {
    // Cuenta que si existe.
    const email = emailUnico('qa.reset');
    await page.goto('/auth/registro');
    await campo(page, 'Nombre', { exact: true }).fill('Ana');
    await campo(page, 'Apellido').fill('Prueba');
    await campo(page, 'Email').fill(email);
    await campo(page, 'Contrasena').fill(PASSWORD);
    await campo(page, 'Nombre del centro').fill(`Centro Reset ${nonce()}`);
    await esperarCupoDeRegistro();
    await page.getByRole('button', { name: 'Crear la cuenta' }).click();
    await expect(page.getByText('Listo, ya lo estamos procesando.')).toBeVisible();
    activarCuentaPorSql(email);

    await page.goto('/auth/olvide-mi-contrasena');
    await campo(page, 'Email').fill(email);
    await page.getByRole('button', { name: 'Enviar el enlace' }).click();
    await expect(page.getByText('Solicitud recibida.')).toBeVisible();
    const mensajeExistente = (await page.locator('.ayuda').last().textContent())?.trim() ?? '';

    // Cuenta que no existe: mismo desenlace, o el formulario seria un oraculo de emails.
    await page.goto('/auth/olvide-mi-contrasena');
    await campo(page, 'Email').fill(emailUnico('qa.reset.fantasma'));
    await page.getByRole('button', { name: 'Enviar el enlace' }).click();
    await expect(page.getByText('Solicitud recibida.')).toBeVisible();
    expect((await page.locator('.ayuda').last().textContent())?.trim()).toBe(mensajeExistente);
  });

  test('un enlace de activacion invalido falla con un mensaje humano y sin internals', async ({
    page,
  }) => {
    await page.goto('/auth/activar?token=este-token-no-existe');

    const alerta = page.getByRole('alert');
    await expect(alerta).toBeVisible();
    esperarSinInternals(
      (await page.locator('body').innerText()) ?? '',
      'la pantalla de activacion con token invalido',
    );
  });

  test('un enlace de restablecimiento invalido falla con un mensaje humano y sin internals', async ({
    page,
  }) => {
    await page.goto('/auth/restablecer?token=este-token-no-existe');

    await campo(page, 'Contrasena nueva').fill(PASSWORD);
    await campo(page, 'Repetir la contrasena').fill(PASSWORD);
    await page.getByRole('button', { name: 'Guardar la contrasena' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    esperarSinInternals(
      await page.locator('body').innerText(),
      'la pantalla de restablecimiento con token invalido',
    );
  });
});
