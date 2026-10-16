import { randomUUID } from 'node:crypto';

import { APIRequestContext, request as fabricaDeRequest } from '@playwright/test';

import { emailUnico, nonce } from './support/akine';
import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { cuentaActiva } from './support/cuentas';
import { API, ApiAkine, Centro, ingresarComoPlataforma, uriDeProblema } from './support/sembrado';
import { paginaDePlataforma, plataformaDisponible } from './support/sembrado-configuracion';

/**
 * E2E de la suscripcion (M01, AKINE-01.01) contra el backend REAL: el plan, su estado y el consumo
 * de cada limite, antes y despues de que la plataforma cambie el plan y suspenda al centro.
 *
 * <p><b>Usa una organizacion propia</b>, como `flujo-sedes`: suspender el centro compartido dejaria
 * en solo lectura a todos los demas specs. Es un alta self-service mas, dentro del cupo de
 * `esperarCupoDeRegistro`. El cambio de plan lo hace la plataforma desde su consola
 * (`/plataforma/suscripciones`), con la version que lee por `getPlatformSubscription` —el defecto D3
 * del pre-QA del 14/10: sin acceso de soporte no tenia de donde sacarla—; la suspension va por el
 * endpoint real. La pantalla del final es la del centro.
 */

interface Suscripcion {
  readonly planName: string;
  readonly status: string;
  readonly version?: number;
}

/** Pedido de la cuenta de plataforma, que opera sin contexto de centro. */
function comoPlataforma(
  http: APIRequestContext,
  token: string,
  ruta: string,
  data: unknown,
): ReturnType<APIRequestContext['post']> {
  return http.post(ruta, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json, application/problem+json',
    },
    data,
  });
}

test.describe('Suscripcion contra el backend real', () => {
  test('plan, estado y limites; despues del cambio de plan y de la suspension', async ({
    page,
    browser,
  }) => {
    test.slow();
    const motivoPlataforma = await plataformaDisponible();
    test.skip(motivoPlataforma !== null, motivoPlataforma ?? '');

    const email = emailUnico('e2e.suscripcion.admin');
    await cuentaActiva({ email, organizationName: `Centro Suscripcion E2E ${nonce()}` });
    const admin = await ApiAkine.como(email);
    try {
      const [{ organizationId }] = await admin.exigir<{ organizationId: number }[]>(
        'GET',
        '/api/v1/me/contexts',
      );
      const ruta = `/api/v1/organizations/${organizationId}/subscription`;
      const inicial = await admin.exigir<Suscripcion>('GET', ruta);
      expect(inicial.status).toBe('ACTIVA');

      // --- Recien dada de alta: plan basico, una sede en uso de una ---------------------------
      await ingresar(page, { emailAdmin: email } as Centro);
      await navegar(page, '/organizacion/suscripcion');
      await expect(page.getByRole('heading', { name: 'Suscripcion activa' })).toBeVisible();
      const detalle = page.locator('dl.detalle');
      await expect(detalle).toContainText(inicial.planName);
      const sedes = page.getByRole('row', { name: /^Sedes habilitadas/ });
      await expect(sedes.getByRole('cell').nth(0)).toHaveText('1');
      await expect(sedes.getByRole('cell').nth(1)).toHaveText('1');

      // --- La plataforma cambia el plan desde su consola, sin acceso de soporte ----------------
      const plataforma = await paginaDePlataforma(browser);
      try {
        await navegar(plataforma, '/plataforma/suscripciones');
        await plataforma.getByLabel('Numero de organizacion').fill(String(organizationId));
        const lectura = respuestaDe(
          plataforma,
          'GET',
          new RegExp(`/platform/organizations/${organizationId}/subscription$`),
        );
        await plataforma.getByRole('button', { name: 'Ver la suscripcion' }).click();
        expect((await lectura).status()).toBe(200);
        // La version que muestra es la de la base, la misma que ve el centro.
        await expect(plataforma.getByTestId('suscripcion-version')).toHaveText(
          String(inicial.version),
        );
        await plataforma.getByLabel('Plan nuevo').selectOption('PROFESIONAL');
        const cambio = respuestaDe(plataforma, 'POST', /\/subscription\/plan-changes$/);
        await plataforma.getByRole('button', { name: 'Cambiar el plan' }).click();
        const respuesta = await cambio;
        expect(respuesta.status(), await respuesta.text()).toBe(200);
        expect(respuesta.request().postDataJSON()).toEqual({
          planCode: 'PROFESIONAL',
          expectedVersion: inicial.version,
        });
        await expect(plataforma.getByText(/El centro paso al plan/)).toBeVisible();
        await expect(plataforma.getByTestId('suscripcion-plan')).not.toHaveText(inicial.planName);
      } finally {
        await plataforma.context().close();
      }

      // --- Y la suspende por el endpoint real --------------------------------------------------
      const motivo = `Falta de pago sintetica ${nonce()}`;
      const http = await fabricaDeRequest.newContext({ baseURL: API });
      try {
        const token = await ingresarComoPlataforma(http);
        const suspension = await comoPlataforma(http, token, `${ruta}/transitions`, {
          toStatus: 'SUSPENDIDA',
          expectedStatus: 'ACTIVA',
          reason: motivo,
        });
        expect(suspension.status(), await suspension.text()).toBeLessThan(300);
      } finally {
        await http.dispose();
      }
      const suspendida = await admin.exigir<Suscripcion>('GET', ruta);
      expect(suspendida.planName).not.toBe(inicial.planName);

      // --- La pantalla lo dice: suspendida con su motivo, el plan nuevo y su tope ------------
      await navegar(page, '/organizacion');
      await expect(page).toHaveURL(/\/organizacion$/);
      await navegar(page, '/organizacion/suscripcion');
      const banner = page.getByRole('alert').filter({ hasText: 'Suscripcion suspendida' });
      await expect(banner).toContainText(`Motivo: ${motivo}`);
      await expect(banner).toContainText('solo lectura');
      await expect(detalle).toContainText(suspendida.planName);
      await expect(detalle).toContainText('SUSPENDIDA');
      await expect(sedes.getByRole('cell').nth(1)).not.toHaveText('1');

      // Y es solo lectura de verdad: el alta de una sede se rechaza con el tipo declarado.
      const alta = await admin.pedir(
        'POST',
        `/api/v1/organizations/${organizationId}/consultorios`,
        { name: `Sede que no nace ${nonce()}` },
        { 'Idempotency-Key': randomUUID() },
      );
      expect(alta.status(), await alta.text()).toBe(409);
      expect(((await alta.json()) as { type: string }).type).toBe(
        uriDeProblema('subscription-suspended'),
      );
    } finally {
      await admin.cerrar();
    }
  });
});
