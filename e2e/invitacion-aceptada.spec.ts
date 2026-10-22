import { test } from '@playwright/test';

import { PASSWORD, emailUnico, ingresarPorPantalla } from './support/akine';
import { respuestaDe } from './support/agenda-real';
import {
  CentroPropio,
  cerrarCentroPropio,
  expect,
  sembrarCentroPropio,
} from './support/centro-propio';
import { enlaceDelCorreo } from './support/cuentas';
import { deAUnLogin } from './support/sembrado';

/**
 * E2E de ACEPTAR una invitacion a colaborar en `/auth/invitacion` (M05, AKINE-02.03) contra el
 * backend REAL.
 *
 * <p>`flujo-invitaciones` abre el enlace y cancela la invitacion desde el centro; aceptar quedaba
 * afuera porque crea una cuenta y un miembro, y el centro compartido de `agenda-setup` es BASICO con
 * tope de miembros. Aca el centro es propio (`support/centro-propio.ts`): administradora,
 * profesional y la invitada son tres de los cinco del plan.
 *
 * <p>La invitada no tiene cuenta: la pantalla le pide nombre y contrasena, el alta sale en el mismo
 * paso (sin correo de activacion: abrir el enlace ya confirmo la direccion) y con esa contrasena
 * entra directo al centro, que es su unico contexto. El enlace no sirve dos veces.
 */
test.describe.configure({ mode: 'default' });

test.describe('Aceptar una invitacion contra el backend real', () => {
  let propio: CentroPropio;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    propio = await sembrarCentroPropio('invitacion');
  });

  test.afterAll(async () => {
    await cerrarCentroPropio(propio);
  });

  test('alguien sin cuenta acepta, crea su cuenta en el mismo paso y entra al centro', async ({
    page,
  }) => {
    const { api, centro } = propio;
    const email = emailUnico('e2e.aceptada');
    const organizacion = `/api/v1/organizations/${centro.organizationId}`;

    await api.exigir('POST', `${organizacion}/colaborador-invitaciones`, {
      email,
      roleCode: 'PROFESIONAL',
      consultorioId: centro.consultorioId,
    });
    const enlace = await enlaceDelCorreo(email, 'Te invitaron a trabajar en');

    // --- El enlace abre la invitacion, sin sesion ------------------------------------------
    await page.goto(enlace.ruta);
    await expect(
      page.getByRole('heading', {
        name: `${centro.nombreCentro} te quiere en su equipo`,
        level: 2,
      }),
    ).toBeVisible();
    await expect(page.getByText(`La invitacion se envio a ${email}.`)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Crea tu cuenta para aceptar' })).toBeVisible();

    // Sin nombre ni contrasena no sale nada.
    await page.getByRole('button', { name: 'Aceptar la invitación' }).click();
    await expect(page.getByText('El nombre es obligatorio.')).toBeVisible();
    await expect(
      page.getByText('La contraseña tiene que tener al menos 10 caracteres.'),
    ).toBeVisible();

    // --- Aceptar -----------------------------------------------------------------------------
    await page.getByLabel('Nombre', { exact: true }).fill('Ines');
    await page.getByLabel('Apellido (opcional)').fill('Invitada');
    await page.getByLabel('Contraseña').fill(PASSWORD);
    const aceptacion = respuestaDe(page, 'POST', /\/auth\/invitations\/accept$/);
    await page.getByRole('button', { name: 'Aceptar la invitación' }).click();
    const aceptada = await aceptacion;
    expect(aceptada.status(), await aceptada.text()).toBe(200);
    const cuerpo = (await aceptada.json()) as {
      cuentaCreada: boolean;
      organizationId: number;
      consultorioId: number;
      membershipId: number;
    };
    expect(cuerpo).toMatchObject({
      cuentaCreada: true,
      organizationId: centro.organizationId,
      consultorioId: centro.consultorioId,
    });
    await expect(page.getByText('Listo: ya sos parte del equipo.')).toBeVisible();
    await expect(page.getByText(/Tu cuenta quedo creada y activa/)).toBeVisible();

    // --- El centro la ve aceptada y como miembro ---------------------------------------------
    const aceptadas = await api.exigir<{ email: string; roleCode: string }[]>(
      'GET',
      `${organizacion}/colaborador-invitaciones?estado=ACEPTADA`,
    );
    expect(aceptadas.find((i) => i.email === email)?.roleCode).toBe('PROFESIONAL');

    // --- El mismo enlace no sirve dos veces --------------------------------------------------
    await page.goto(enlace.ruta);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aceptar la invitación' })).toHaveCount(0);

    // --- Entra con la contrasena que eligio, directo al centro -------------------------------
    await page.goto('/auth/ingresar');
    await deAUnLogin(async () => {
      await ingresarPorPantalla(page, email);
      // Un solo contexto: el selector no pregunta.
      await expect(page).not.toHaveURL(/\/(auth|seleccionar-contexto)/, { timeout: 15_000 });
    });
    await expect(page.getByText(centro.nombreCentro).first()).toBeVisible();
  });
});
