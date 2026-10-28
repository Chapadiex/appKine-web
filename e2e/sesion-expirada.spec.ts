import { Page, Request, expect, test } from '@playwright/test';

import {
  PASSWORD,
  emailUnico,
  esperarFormularioEnlazado,
  ingresarPorPantalla,
  nonce,
} from './support/akine';
import { navegar } from './support/agenda-real';
import { cuentaActiva } from './support/cuentas';
import { ApiAkine, deAUnLogin } from './support/sembrado';

/**
 * E2E de `/auth/sesion-expirada` (M02, AKINE-01.02) contra el backend REAL.
 *
 * <p>La pantalla es el destino de un solo camino: una peticion a la API responde 401, el
 * interceptor pide `/auth/refresh` con la cookie, y el refresh TAMBIEN responde 401 —la sesion
 * murio del lado del servidor—. Hasta aca solo la cubria el unitario, con las dos respuestas
 * simuladas.
 *
 * <h2>Que es real y que no</h2>
 *
 * <p><b>La muerte de la sesion es real:</b> la misma cuenta, desde otro dispositivo (un cliente HTTP
 * aparte), pide "cerrar sesion en todos lados" (`DELETE /auth/sessions`), que revoca en el servidor
 * todos los refresh vivos de la cuenta, el del navegador incluido. El 401 del refresh lo emite el
 * backend, no el test.
 *
 * <p><b>El 401 del access token se provoca:</b> el access token sigue siendo valido diez minutos
 * despues de la revocacion (ADR-0017) y esperar diez minutos no es un test. Se le cambia la firma
 * al token de UNA peticion con `route.continue` —la peticion igual viaja al backend real, que la
 * rechaza con su 401 de "credencial no valida o vencida", el mismo para firma rota y para token
 * vencido—. No hay `route.fulfill`: ninguna respuesta la inventa el test.
 */

/** Peticion a la API propia que no es de sesion: la que tiene que responder 401. */
function esDeLaApi(url: URL): boolean {
  return url.pathname.startsWith('/api/v1/') && !url.pathname.startsWith('/api/v1/auth/');
}

/** El mismo token con la firma alterada: un JWT que el backend no puede verificar. */
function conFirmaRota(autorizacion: string): string {
  const ultimo = autorizacion.at(-1);
  return `${autorizacion.slice(0, -1)}${ultimo === 'A' ? 'B' : 'A'}`;
}

/** Hace que la PROXIMA peticion a la API viaje con la firma rota, y devuelve esa peticion. */
async function romperElProximoToken(page: Page): Promise<() => Request | undefined> {
  let alterada: Request | undefined;
  await page.route(
    esDeLaApi,
    async (ruta) => {
      alterada = ruta.request();
      const cabeceras = await ruta.request().allHeaders();
      expect(cabeceras['authorization'], 'la pantalla manda su access token').toMatch(/^Bearer /);
      await ruta.continue({
        headers: { ...cabeceras, authorization: conFirmaRota(cabeceras['authorization']) },
      });
    },
    { times: 1 },
  );
  return () => alterada;
}

test.describe('Sesion expirada contra el backend real', () => {
  test('la sesion revocada en otro dispositivo lleva a la pantalla y de vuelta a donde estaba', async ({
    page,
  }) => {
    const email = emailUnico('e2e.expirada');
    await cuentaActiva({ email, organizationName: `Centro Expirada ${nonce()}` });

    // --- Adentro, trabajando ----------------------------------------------------------------
    await deAUnLogin(async () => {
      await ingresarPorPantalla(page, email);
      await expect(page).not.toHaveURL(/\/(auth|seleccionar-contexto)/, { timeout: 15_000 });
    });
    await navegar(page, '/organizacion');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // --- Otro dispositivo cierra todas las sesiones de la cuenta ----------------------------
    const otroDispositivo = await deAUnLogin(() => ApiAkine.como(email));
    try {
      const cierre = await otroDispositivo.exigir<{ closedSessions: number }>(
        'DELETE',
        '/api/v1/auth/sessions',
      );
      // La del navegador y la del propio "otro dispositivo".
      expect(cierre.closedSessions).toBeGreaterThanOrEqual(2);
    } finally {
      await otroDispositivo.cerrar();
    }

    // --- La proxima peticion vuelve con 401 y el refresh tambien ----------------------------
    const alterada = await romperElProximoToken(page);
    const primerRechazo = page.waitForResponse(
      (r) => esDeLaApi(new URL(r.url())) && r.status() === 401,
    );
    const refresh = page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith('/api/v1/auth/refresh'),
    );
    await navegar(page, '/pacientes');

    const rechazo = await primerRechazo;
    expect(rechazo.request(), 'el 401 es de la peticion alterada').toBe(alterada());
    expect(((await rechazo.json()) as { type: string }).type).toBe(
      'https://akine.app/problems/unauthorized',
    );
    const renovacion = await refresh;
    expect(renovacion.status(), 'el refresh revocado lo rechaza el servidor').toBe(401);

    // --- La pantalla ---------------------------------------------------------------------------
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/auth/sesion-expirada' &&
        url.searchParams.get('volverA') === '/pacientes',
    );
    await expect(page.getByRole('heading', { name: 'Tu sesión expiró', level: 1 })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(
      'No pudimos renovarla, así que la cerramos.',
    );

    // --- "Volver a iniciar sesion" conserva el destino y lo cumple ---------------------------
    await page.getByRole('link', { name: 'Volver a ingresar' }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/auth/ingresar' && url.searchParams.get('volverA') === '/pacientes',
    );
    await deAUnLogin(async () => {
      // La pantalla de ingreso la acaba de montar el router: ver `esperarFormularioEnlazado`.
      await esperarFormularioEnlazado(page.getByLabel('Correo electrónico'));
      await page.getByLabel('Correo electrónico').fill(email);
      await page.getByLabel('Contraseña').fill(PASSWORD);
      await page.getByRole('button', { name: 'Ingresar' }).click();
      await expect(page).toHaveURL((url) => url.pathname === '/pacientes', { timeout: 15_000 });
    });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
