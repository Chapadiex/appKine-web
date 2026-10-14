import { request as fabricaDeRequest } from '@playwright/test';

import { emailUnico, nonce } from './support/akine';
import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { cuentaActiva } from './support/cuentas';
import { API, ApiAkine, Centro, ingresarComoPlataforma } from './support/sembrado';
import { plataformaDisponible } from './support/sembrado-configuracion';

/**
 * E2E de sedes (M03, AKINE-02.01 + A-8) contra el backend REAL: alta de una sede en un acto con
 * su primer box y su horario general, y baja con motivo que queda en el historico.
 *
 * <p><b>Usa una organizacion propia, no el centro compartido.</b> Una segunda sede en el centro
 * le daria a su administradora dos contextos, y todos los demas specs entran confiando en que el
 * selector no pregunta. Ademas el alta self-service nace en el plan BASICO, que admite una sola
 * sede: la plataforma la pasa a PROFESIONAL por el endpoint real, como hace `AltaDeSedeEnUnActoIT`.
 *
 * <p>El 409 de la baja con turnos pendientes (`consultorio-has-active-references`, E-1) lo prueba
 * `SondasDeImpactoIT` del backend; aca se recorre la pantalla de punta a punta.
 */
test.describe('Sedes contra el backend real', () => {
  test('alta en un acto con primer box y horario general, y baja con motivo', async ({ page }) => {
    test.slow();
    const motivo = await plataformaDisponible();
    test.skip(motivo !== null, motivo ?? '');

    const sufijo = nonce();
    const email = emailUnico('e2e.sedes.admin');
    await cuentaActiva({ email, organizationName: `Centro Sedes E2E ${sufijo}` });

    const admin = await ApiAkine.como(email);
    let organizationId: number;
    try {
      [{ organizationId }] = await admin.exigir<{ organizationId: number }[]>(
        'GET',
        '/api/v1/me/contexts',
      );
      const { version } = await admin.exigir<{ version?: number }>(
        'GET',
        `/api/v1/organizations/${organizationId}/subscription`,
      );

      // --- La plataforma le da un plan sin tope de sedes ---
      const http = await fabricaDeRequest.newContext({ baseURL: API });
      try {
        const token = await ingresarComoPlataforma(http);
        const cambio = await http.post(
          `/api/v1/organizations/${organizationId}/subscription/plan-changes`,
          {
            headers: {
              authorization: `Bearer ${token}`,
              accept: 'application/json, application/problem+json',
            },
            data: { planCode: 'PROFESIONAL', expectedVersion: version ?? 0 },
          },
        );
        expect(cambio.status(), await cambio.text()).toBe(200);
      } finally {
        await http.dispose();
      }
    } finally {
      await admin.cerrar();
    }

    await ingresar(page, { emailAdmin: email } as Centro);

    // --- Alta en un acto: sede + primer box + horario general ---
    const nombre = `Sede Norte ${sufijo}`;
    await navegar(page, '/organizacion/sedes/nueva');
    await page.getByLabel('Nombre de la sede').fill(nombre);
    await page.getByLabel('Nombre del box').fill('Box 1');
    await page.getByRole('button', { name: 'Agregar una franja' }).click();
    await page.locator('#sede-horario-dia-0').selectOption({ label: 'Lunes' });
    await page.locator('#sede-horario-desde-0').fill('08:00');
    await page.locator('#sede-horario-hasta-0').fill('20:00');
    await page.getByRole('button', { name: 'Continuar' }).click();

    const alta = respuestaDe(page, 'POST', /\/organizations\/\d+\/consultorios$/);
    await page.getByRole('button', { name: 'Crear la sede' }).click();
    const creada = await alta;
    expect(creada.status(), await creada.text()).toBe(201);
    await expect(page.getByText(`La sede "${nombre}" quedo creada.`)).toBeVisible();
    await expect(page.getByText('Se creo junto con su primer box.')).toBeVisible();
    await expect(page.getByText(/El horario general quedo cargado/)).toBeVisible();

    // --- Baja con motivo desde el listado ---
    await page.getByRole('link', { name: 'Volver al listado de sedes' }).click();
    const region = page.getByRole('region', { name: 'Sedes de la organizacion' });
    const fila = region.getByRole('row').filter({ hasText: nombre });
    await expect(fila).toBeVisible();
    await fila.getByRole('button', { name: 'Dar de baja' }).click();
    await page.locator('#baja-reason').fill('Se cierra la sede norte');
    const baja = respuestaDe(page, 'POST', /\/consultorios\/\d+\/deactivate$/);
    await page.getByRole('button', { name: 'Confirmar la baja' }).click();
    expect((await baja).status()).toBe(200);
    await expect(
      page.getByText('La sede quedo dada de baja. Sigue en el listado, con el motivo.'),
    ).toBeVisible();

    await page.getByLabel('Mostrar').selectOption({ label: 'Solo las dadas de baja' });
    const historico = region.getByRole('row').filter({ hasText: nombre });
    await expect(historico).toBeVisible();
    await expect(historico.getByText('Motivo: Se cierra la sede norte')).toBeVisible();
  });
});
