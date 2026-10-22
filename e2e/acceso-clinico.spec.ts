import { expect, test } from '@playwright/test';

import { idDeCuenta, sql } from './support/akine';
import { navegar } from './support/agenda-real';
import {
  HistoriaSembrada,
  MOTIVO_DE_ACCESO,
  entrarComoAdministradora,
  entrarConContexto,
  sembrarHistoria,
} from './support/historia-clinica';

/**
 * E2E de la entrada a la Historia Clinica desde el Paciente 360 (D-e), contra el backend real.
 *
 * <p>Los dos caminos que importan: la profesional (`hc:read` por su rol) ve el enlace, declara el
 * motivo y la lectura queda auditada con el; la administradora (sin `hc:read`) no ve el enlace, ve
 * solo los datos administrativos y, si llega igual por URL, el backend la niega. Esto ultimo es lo
 * que prueba que el enlace oculto es UX y no la barrera.
 */
test.describe('Acceso clinico desde el Paciente 360 (D-e)', () => {
  test.describe.configure({ mode: 'default', timeout: 120_000 });

  let sembrada: HistoriaSembrada;

  test.beforeAll(async ({ request }) => {
    // Dos altas por sembrado contra un limite de 5 por minuto: la espera de cupo puede ser larga.
    test.setTimeout(300_000);
    sembrada = await sembrarHistoria(request);
  });

  test('permitido: de la ficha a la historia con motivo auditado, y de vuelta', async ({
    page,
  }) => {
    await entrarConContexto(page, sembrada);
    await navegar(page, `/pacientes/${sembrada.personaId}`);

    // La ficha sigue sin mostrar nada clinico: ofrece el camino, no el contenido.
    await expect(
      page.locator('app-ayuda').getByText('Esta ficha no muestra nada clínico', { exact: true }),
    ).toBeAttached();
    await page.getByRole('link', { name: 'Abrir la historia clínica' }).click();

    await expect(page).toHaveURL(new RegExp(`/historia-clinica/personas/${sembrada.personaId}$`));
    // El motivo no viaja en la URL ni antes ni despues de declararlo.
    await page.getByRole('textbox', { name: 'Motivo del acceso' }).fill(MOTIVO_DE_ACCESO);
    await page.getByRole('button', { name: 'Ver la historia clínica' }).click();
    await expect(page.getByRole('heading', { name: sembrada.nombreCompleto })).toBeVisible();
    expect(page.url()).not.toContain(encodeURIComponent(MOTIVO_DE_ACCESO));

    const cuenta = idDeCuenta(sembrada.email);
    const auditadas = sql(
      `SELECT COUNT(*) FROM audit_event WHERE organization_id=${sembrada.organizationId} ` +
        `AND actor_account_id=${cuenta} AND event_type='HISTORIA_CLINICA_ACCESSED' ` +
        `AND (reason LIKE '%${MOTIVO_DE_ACCESO}%' OR details LIKE '%${MOTIVO_DE_ACCESO}%')`,
    );
    expect(Number(auditadas), 'la lectura quedo auditada con el motivo').toBeGreaterThan(0);

    await page.getByRole('link', { name: 'Ficha', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/pacientes/${sembrada.personaId}$`));
  });

  test('denegado: sin hc:read la ficha no la ofrece y el backend la niega por URL', async ({
    page,
  }) => {
    await entrarComoAdministradora(page, sembrada);
    await navegar(page, `/pacientes/${sembrada.personaId}`);

    await expect(
      page.locator('app-ayuda').getByText('Esta ficha no muestra nada clínico', { exact: true }),
    ).toBeAttached();
    await expect(page.getByRole('link', { name: 'Abrir la historia clínica' })).toHaveCount(0);
    // Lo que si ve el mostrador: que hay historia, sin contenido (matriz §32, api #109).
    await expect(
      page
        .getByRole('region', { name: 'Historia clínica: datos administrativos' })
        .getByText('Historia abierta el'),
    ).toBeVisible();

    // Por URL directa: el guard no existe a proposito, la autoridad es el backend.
    await navegar(page, `/historia-clinica/personas/${sembrada.personaId}`);
    await expect(page.getByText('No tenés permiso para ver historias clínicas')).toBeVisible();
    // No se ofrece el motivo: sin permiso, declarar un motivo no habilita nada.
    await expect(page.getByRole('textbox', { name: 'Motivo del acceso' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reintentar' })).toHaveCount(0);

    // Y el rechazo no dejo ninguna lectura clinica a nombre de la administradora.
    const cuenta = idDeCuenta(sembrada.emailAdmin);
    const lecturas = sql(
      `SELECT COUNT(*) FROM audit_event WHERE organization_id=${sembrada.organizationId} ` +
        `AND actor_account_id=${cuenta} AND event_type='HISTORIA_CLINICA_ACCESSED'`,
    );
    expect(Number(lecturas), 'un acceso denegado no es una lectura').toBe(0);
  });
});
