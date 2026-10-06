import { expect, test } from '@playwright/test';

import {
  HistoriaSembrada,
  MOTIVO_DE_ACCESO,
  entrarConContexto,
  quitarPermisosClinicos,
  sembrarHistoria,
} from './support/historia-clinica';

/**
 * E2E de la entrada a la Historia Clinica desde el Paciente 360 (D-e), contra el backend real.
 *
 * <p>Los dos caminos que importan: con `hc:read` la ficha ofrece la historia y la historia pide el
 * motivo; sin el permiso la ficha no la ofrece y, si se llega igual por URL, el backend la niega.
 * Esto ultimo es lo que prueba que el enlace oculto es UX y no la barrera.
 */
test.describe('Acceso clinico desde el Paciente 360 (D-e)', () => {
  // Cada test siembra una organizacion, y el alta esta limitada a 5 por minuto: el helper espera
  // turno (`esperarCupoDeRegistro`), y esa espera no puede comerse los 30 s por defecto.
  test.describe.configure({ timeout: 120_000 });

  let sembrada: HistoriaSembrada;

  test.beforeEach(async ({ request }) => {
    sembrada = await sembrarHistoria(request);
  });

  test('con permiso: de la ficha a la historia, motivo, y de vuelta a la ficha', async ({
    page,
  }) => {
    await entrarConContexto(page, sembrada);
    await page.goto(`/pacientes/${sembrada.personaId}`);

    // La ficha sigue sin mostrar nada clinico: ofrece el camino, no el contenido.
    await expect(page.getByText('Esta ficha no muestra nada clinico')).toBeVisible();
    await page.getByRole('link', { name: 'Abrir la historia clinica' }).click();

    await expect(page).toHaveURL(new RegExp(`/historia-clinica/personas/${sembrada.personaId}$`));
    await page.getByRole('textbox', { name: 'Motivo del acceso' }).fill(MOTIVO_DE_ACCESO);
    await page.getByRole('button', { name: 'Ver la historia clinica' }).click();
    await expect(page.getByRole('heading', { name: sembrada.nombreCompleto })).toBeVisible();

    await page.getByRole('link', { name: 'Volver a la ficha de la persona' }).click();
    await expect(page).toHaveURL(new RegExp(`/pacientes/${sembrada.personaId}$`));
  });

  test('sin permiso: la ficha no la ofrece y el backend la niega aunque se llegue por URL', async ({
    page,
    request,
  }) => {
    await quitarPermisosClinicos(request, sembrada);
    await entrarConContexto(page, sembrada);

    await page.goto(`/pacientes/${sembrada.personaId}`);
    await expect(page.getByText('Esta ficha no muestra nada clinico')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Abrir la historia clinica' })).toHaveCount(0);

    // Por URL directa: el guard no existe a proposito, la autoridad es el backend.
    await page.goto(`/historia-clinica/personas/${sembrada.personaId}`);
    await expect(page.getByText('No tenes permiso para ver historias clinicas')).toBeVisible();
    // No se ofrece el motivo: sin permiso, declarar un motivo no habilita nada.
    await expect(page.getByRole('textbox', { name: 'Motivo del acceso' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reintentar' })).toHaveCount(0);
  });
});
