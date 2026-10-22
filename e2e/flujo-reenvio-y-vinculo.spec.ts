import { emailUnico, nonce } from './support/akine';
import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { ASUNTO, enlaceDelCorreo, registrarCuenta } from './support/cuentas';
import { ApiAkine, Centro } from './support/sembrado';

/**
 * E2E de dos pantallas sueltas de cuentas y colaboradores contra el backend REAL:
 * `/auth/reenviar-activacion` (M02) y `/organizacion/colaboradores/nuevo` (M05).
 *
 * <p>Una cuenta nueva se registra y pierde el primer correo: lo pide de nuevo por pantalla, se
 * activa con el SEGUNDO enlace, y despues, como administradora de su propio consultorio (el alta
 * self-service lo crea), vincula por pantalla a la profesional del centro, sin invitacion. Es un
 * alta self-service mas, dentro del cupo de `esperarCupoDeRegistro`.
 *
 * <p><b>El vinculo va a la organizacion propia y no al centro compartido:</b> el centro esta en el
 * plan BASICO (5 miembros activos) y otros specs ya le suman colaboradores; con la suite entera el
 * alta respondia `plan-limit-exceeded` (primer CI de web #82). La profesional del centro solo
 * ingresa por la API eligiendo el contexto del centro, asi que un contexto mas no la cambia.
 */
test.describe('Reenvio de activacion y vinculo directo contra el backend real', () => {
  test('pedir otro enlace, activarse con el y vincular a una profesional existente', async ({
    page,
    browser,
    centro,
  }) => {
    test.slow();
    const email = emailUnico('e2e.reenvio');
    await registrarCuenta({ email, organizationName: `Consultorio Reenvio ${nonce()}` });
    const primero = await enlaceDelCorreo(email, ASUNTO.activacion);

    // --- Sin sesion: pedir otro enlace y activarse con ese -----------------------------------
    const anonimo = await browser.newContext();
    try {
      const pagina = await anonimo.newPage();
      await pagina.goto('/auth/reenviar-activacion');
      await expect(
        pagina.getByRole('heading', { name: 'Reenviar la activación', level: 1 }),
      ).toBeVisible();
      await pagina.getByRole('textbox', { name: 'Correo electrónico' }).fill(email);
      await pagina.getByRole('button', { name: 'Reenviar la activación' }).click();
      await expect(pagina.getByRole('heading', { name: 'Revisá tu correo' })).toBeVisible();

      const segundo = await enlaceDelCorreo(email, ASUNTO.activacion, [primero.idCorreo]);
      expect(segundo.token).not.toBe(primero.token);
      await pagina.goto(segundo.ruta);
      await expect(
        pagina.getByRole('heading', { name: 'Cuenta activada', level: 1 }),
      ).toBeVisible();
    } finally {
      await anonimo.close();
    }

    // --- Desde su consultorio propio, vincula a la profesional del centro por pantalla -------
    const propia = await ApiAkine.como(email);
    const [{ consultorioId }] = await propia
      .exigir<{ consultorioId: number }[]>('GET', '/api/v1/me/contexts')
      .finally(() => propia.cerrar());
    await ingresar(page, { emailAdmin: email } as Centro);
    await navegar(page, '/organizacion/colaboradores/nuevo');
    await expect(
      page.getByRole('heading', { name: 'Vincular colaborador', level: 1 }),
    ).toBeVisible();
    await page.getByLabel('Email de la cuenta').fill(centro.emailProfesional);
    await page.getByLabel('Rol', { exact: true }).selectOption({ value: 'PROFESIONAL' });
    await page.getByLabel('Una sede en particular').check();
    await page.getByLabel('Sede', { exact: true }).selectOption({ value: String(consultorioId) });
    await page.getByLabel('Motivo').fill('Atiende tambien en este consultorio');
    const alta = respuestaDe(page, 'POST', /\/memberships$/);
    await page.getByRole('button', { name: 'Vincular' }).click();
    const creado = await alta;
    expect(creado.status(), await creado.text()).toBe(201);
    const { membershipId } = (await creado.json()) as { membershipId: number };
    await expect(page.getByText(`Vinculo creado (número ${membershipId}).`)).toBeVisible();

    await page.getByRole('link', { name: 'Volver al listado' }).click();
    await expect(page).toHaveURL(/\/organizacion\/colaboradores$/);
    await expect(page.getByRole('row').filter({ hasText: centro.emailProfesional })).toContainText(
      'Profesional',
    );
  });
});
