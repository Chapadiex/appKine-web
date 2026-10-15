import { expect, test } from '@playwright/test';

import { sql } from './support/akine';
import { navegar } from './support/agenda-real';
import {
  HistoriaSembrada,
  MOTIVO_DE_ACCESO,
  abrirHistoriaConMotivo,
  entrarConContexto,
  sembrarHistoria,
} from './support/historia-clinica';

/**
 * E2E de los Casos Clinicos (D-b, RF-M10-001..006) contra el backend real.
 *
 * <p>Un solo recorrido, en el orden en que lo vive un profesional: abrir el caso desde la historia
 * con la oferta y la responsable elegidas de listas (nadie escribe un id), editarlo, cambiar el
 * equipo DOS veces seguidas —el defecto de `appKine-api` #109 era que la segunda moria en 409—,
 * cerrarlo con motivo, verlo en historicos y reabrirlo. Despues, el aviso de posible duplicado y el
 * enlace directo a un caso sin motivo declarado.
 */
test.describe('Casos clinicos (D-b)', () => {
  test.describe.configure({ mode: 'default', timeout: 180_000 });

  let sembrada: HistoriaSembrada;

  test.beforeAll(async ({ request }) => {
    sembrada = await sembrarHistoria(request);
  });

  test('abrir, editar, cambiar el equipo dos veces, cerrar y reabrir', async ({ page }) => {
    await abrirHistoriaConMotivo(page, sembrada);
    const casos = page.getByRole('region', { name: 'Casos clinicos' });
    await expect(casos.getByText('No hay casos activos.')).toBeVisible();

    // --- Alta compacta ---------------------------------------------------------------------
    await casos.getByText('Abrir un caso').click();
    // Sin datos no se manda nada.
    await casos.getByRole('button', { name: 'Abrir el caso' }).click();
    await expect(casos.getByText('Elegi la oferta del caso.')).toBeVisible();
    await expect(casos.getByText('El diagnostico presuntivo es obligatorio.')).toBeVisible();

    await casos
      .getByRole('combobox', { name: 'Oferta que motiva el caso' })
      .selectOption({ label: sembrada.oferta.nombre });
    await casos
      .getByRole('textbox', { name: 'Diagnostico presuntivo' })
      .fill('Lumbalgia mecanica sintetica');
    await casos
      .getByRole('textbox', { name: 'Objetivo terapeutico (opcional)' })
      .fill('Volver a correr sin dolor');
    const responsable = casos.getByRole('combobox', { name: 'Profesional responsable (opcional)' });
    await expect(
      responsable.locator('option', { hasText: sembrada.nombreProfesional }),
    ).toHaveCount(1);
    const valor = await responsable
      .locator('option', { hasText: sembrada.nombreProfesional })
      .getAttribute('value');
    await responsable.selectOption(valor ?? '');
    await casos.getByRole('button', { name: 'Abrir el caso' }).click();

    // El alta lleva al caso, dentro de la MISMA visita: el motivo no se vuelve a pedir.
    await expect(page.getByRole('heading', { name: /Caso 1 · / })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Motivo del acceso' })).toHaveCount(0);
    await expect(page.getByTestId('caso-estado')).toHaveText('Activo');
    const equipo = page.getByRole('list', { name: 'Integrantes del equipo' });
    await expect(equipo).toContainText(sembrada.nombreProfesional);

    // --- Edicion ---------------------------------------------------------------------------
    await page
      .getByRole('textbox', { name: 'Diagnostico presuntivo' })
      .fill('Lumbalgia mecanica sintetica, sin irradiacion');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Se guardaron el diagnostico y el objetivo.')).toBeVisible();

    // --- Equipo: dos cambios seguidos sin releer (#109) -----------------------------------
    await equipo
      .getByRole('combobox', { name: new RegExp(`Rol de .*${sembrada.nombreProfesional}`) })
      .selectOption('TRATANTE');
    await page.getByRole('button', { name: 'Guardar el equipo' }).click();
    await expect(page.getByText('Se guardo el equipo del caso.')).toBeVisible();

    await equipo
      .getByRole('combobox', { name: new RegExp(`Rol de .*${sembrada.nombreProfesional}`) })
      .selectOption('RESPONSABLE');
    await page.getByRole('button', { name: 'Guardar el equipo' }).click();
    await expect(page.getByText('Se guardo el equipo del caso.')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);

    const historial = page.getByRole('list', { name: 'Movimientos del caso' });
    await expect(historial.getByText('Cambio de equipo')).toHaveCount(2);

    // --- Cierre con motivo -------------------------------------------------------------------
    await page.getByRole('button', { name: 'Cerrar el caso' }).last().click();
    await expect(page.getByText('El motivo es obligatorio.')).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Motivo del cierre' })
      .fill('Alta por objetivo cumplido');
    await page.getByRole('button', { name: 'Cerrar el caso' }).last().click();
    await expect(page.getByTestId('caso-estado')).toHaveText('Cerrado');
    await expect(page.getByText('Alta por objetivo cumplido').first()).toBeVisible();
    // Un caso cerrado no se edita ni cambia de equipo: solo se reabre.
    await expect(page.getByRole('button', { name: 'Guardar el equipo' })).toHaveCount(0);

    // En la historia aparece en historicos.
    await page.getByRole('link', { name: 'Volver a la historia clinica' }).click();
    const cerrados = page.getByRole('list', { name: 'Casos cerrados' });
    await expect(cerrados.getByRole('link', { name: /Caso 1/ })).toBeVisible();
    await cerrados.getByRole('link', { name: /Caso 1/ }).click();

    // --- Reapertura con motivo ---------------------------------------------------------------
    await page
      .getByRole('textbox', { name: 'Motivo de la reapertura' })
      .fill('Recidiva a las dos semanas');
    await page.getByRole('button', { name: 'Reabrir el caso' }).last().click();
    await expect(page.getByTestId('caso-estado')).toHaveText('Activo');
    await expect(historial.getByText('Reapertura')).toBeVisible();

    // El estado quedo asi en la base, no solo en pantalla.
    const estado = sql(
      `SELECT estado FROM caso_clinico WHERE historia_clinica_id=${sembrada.historiaClinicaId}`,
    );
    expect(estado).toBe('ACTIVO');
  });

  test('un segundo caso de la misma oferta avisa el posible duplicado y se confirma', async ({
    page,
  }) => {
    await abrirHistoriaConMotivo(page, sembrada);
    const casos = page.getByRole('region', { name: 'Casos clinicos' });
    await expect(casos.getByRole('list', { name: 'Casos activos' })).toBeVisible();
    await casos.getByText('Abrir un caso').click();
    await casos
      .getByRole('combobox', { name: 'Oferta que motiva el caso' })
      .selectOption({ label: sembrada.oferta.nombre });
    await casos.getByRole('textbox', { name: 'Diagnostico presuntivo' }).fill('Cervicalgia');
    await casos.getByRole('button', { name: 'Abrir el caso' }).click();

    await expect(casos.getByText(/Ya hay un caso activo de la misma oferta/)).toBeVisible();
    await expect(casos.getByRole('link', { name: /Ver el caso 1/ })).toBeVisible();
    await casos.getByRole('button', { name: 'Abrir igual un caso nuevo' }).click();
    await expect(page.getByRole('heading', { name: /Caso 2 · / })).toBeVisible();
  });

  test('el enlace directo a un caso sin motivo lo pide antes de mostrar nada', async ({ page }) => {
    const casoId = Number(
      sql(
        `SELECT id FROM caso_clinico WHERE historia_clinica_id=${sembrada.historiaClinicaId} ` +
          `ORDER BY id LIMIT 1`,
      ),
    );
    await entrarConContexto(page, sembrada);
    await navegar(page, `/historia-clinica/personas/${sembrada.personaId}/casos/${casoId}`);

    await expect(page.getByRole('heading', { name: 'Declara el motivo del acceso' })).toBeVisible();
    await expect(page.getByText('Lumbalgia')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Motivo del acceso' }).fill(MOTIVO_DE_ACCESO);
    await page.getByRole('button', { name: 'Ver el caso' }).click();
    await expect(page.getByRole('heading', { name: /Caso 1 · / })).toBeVisible();
    await expect(page.getByText('Lumbalgia mecanica sintetica, sin irradiacion')).toBeVisible();
  });
});
