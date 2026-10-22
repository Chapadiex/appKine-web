import { emailUnico } from './support/akine';
import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { abrirFiltros } from './support/filtros';
import { enlaceDelCorreo } from './support/cuentas';

/**
 * E2E de las invitaciones de la organizacion (M02, AKINE-02.03) contra el backend REAL: invitar por
 * pantalla a alguien que todavia no tiene cuenta, que el enlace del correo abra la invitacion sin
 * sesion, y cancelarla con motivo: el mismo enlace deja de servir.
 *
 * <p>La persona invitada no se registra (no consume cupo de altas): lo que se prueba es el ciclo de
 * la invitacion desde el lado del centro, con el correo real que el backend dejo en Mailpit.
 */
test.describe('Invitaciones contra el backend real', () => {
  test('invitar, abrir el enlace sin sesion y cancelar con motivo', async ({
    page,
    browser,
    api,
    centro,
  }) => {
    const email = emailUnico('e2e.invitada');
    const motivo = 'Se incorpora el mes que viene';

    await ingresar(page, centro);
    await navegar(page, '/organizacion/colaboradores/invitaciones');
    await expect(page.getByRole('heading', { name: 'Invitaciones', level: 1 })).toBeVisible();

    // --- Invitar --------------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Invitar a alguien' }).click();
    await page.getByLabel('Email de la persona').fill(email);
    await page.getByLabel('Rol con el que entraria').selectOption({ label: 'Profesional' });
    await page.getByLabel('Donde trabajaria').selectOption({ value: 'SEDE' });
    const alta = respuestaDe(page, 'POST', /\/colaborador-invitaciones$/);
    await page.getByRole('button', { name: 'Enviar la invitacion' }).click();
    const creada = await alta;
    expect(creada.status(), await creada.text()).toBe(201);
    await expect(page.getByText('La invitación salio por correo.')).toBeVisible();
    const fila = page
      .getByRole('region', { name: 'Invitaciones enviadas por la organización' })
      .getByRole('row', { name: new RegExp(email.replace(/[.]/g, '\\.')) });
    await expect(fila).toContainText('Profesional');
    await expect(fila).toContainText('Pendiente');

    // --- El enlace del correo abre la invitacion, sin sesion ----------------------------------
    const enlace = await enlaceDelCorreo(email, 'Te invitaron a trabajar en');
    const invitada = await browser.newContext();
    try {
      const anonima = await invitada.newPage();
      await anonima.goto(enlace.ruta);
      await expect(
        anonima.getByRole('heading', { name: 'Te invitaron a AKINE', level: 1 }),
      ).toBeVisible();

      // --- Cancelar con motivo --------------------------------------------------------------
      await fila.getByRole('button', { name: 'Cancelar' }).click();
      await page.getByLabel('Motivo de la cancelación').fill(motivo);
      const cancelacion = respuestaDe(page, 'POST', /\/colaborador-invitaciones\/\d+\/cancel$/);
      await page.getByRole('button', { name: 'Cancelar la invitación' }).click();
      expect((await cancelacion).status()).toBeLessThan(300);
      await abrirFiltros(page);
      await page.getByLabel('Mostrar').selectOption({ label: 'Las canceladas' });
      await expect(fila).toContainText(motivo);

      // El mismo enlace ya no abre nada.
      await anonima.reload();
      await expect(anonima.getByRole('alert')).toBeVisible();
      await expect(anonima.getByRole('heading', { name: 'Te invitaron a AKINE' })).toHaveCount(0);
    } finally {
      await invitada.close();
    }

    const canceladas = await api.exigir<{ email: string; resolucionNota?: string }[]>(
      'GET',
      `/api/v1/organizations/${centro.organizationId}/colaborador-invitaciones?estado=CANCELADA`,
    );
    expect(canceladas.find((i) => i.email === email)?.resolucionNota).toBe(motivo);
  });
});
