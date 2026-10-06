import { Page, expect, test } from '@playwright/test';

import { sql } from './support/akine';
import {
  HistoriaSembrada,
  MOTIVO_DE_ACCESO,
  TEXTO_DE_LA_ENTRADA,
  entrarConContexto,
  sembrarHistoria,
} from './support/historia-clinica';

/**
 * E2E del timeline de la Historia Clinica (D-a, RF-M09-001/003, RF-M25) contra el backend real.
 *
 * <p>Todo corre contra MySQL y Spring Boot de verdad: el motivo de acceso, el cursor, la
 * enmienda versionada y la descarga binaria son justamente lo que un `route.fulfill` dejaria sin
 * probar. La cuenta no tiene relacion asistencial con la persona, asi que el primer paso es
 * siempre declarar el motivo.
 */

/** Entra, abre la historia sembrada y declara el motivo: la cuenta no tiene relacion asistencial. */
async function abrirHistoriaConMotivo(page: Page, sembrada: HistoriaSembrada): Promise<void> {
  await entrarConContexto(page, sembrada);
  await page.goto(`/historia-clinica/personas/${sembrada.personaId}`);
  await page.getByRole('textbox', { name: 'Motivo del acceso' }).fill(MOTIVO_DE_ACCESO);
  await page.getByRole('button', { name: 'Ver la historia clinica' }).click();
}

test.describe('Historia clinica - timeline (D-a)', () => {
  let sembrada: HistoriaSembrada;

  test.beforeEach(async ({ request }) => {
    sembrada = await sembrarHistoria(request);
  });

  test('sin relacion asistencial pide motivo, y con el muestra cabecera y timeline', async ({
    page,
  }) => {
    await entrarConContexto(page, sembrada);
    await page.goto(`/historia-clinica/personas/${sembrada.personaId}`);

    await expect(page.getByRole('heading', { name: 'Declara el motivo del acceso' })).toBeVisible();
    // Sin motivo no se manda nada: el campo obligatorio frena el envio.
    await page.getByRole('button', { name: 'Ver la historia clinica' }).click();
    await expect(page.getByText('Sin motivo no se puede abrir la historia.')).toBeVisible();

    await page.getByRole('textbox', { name: 'Motivo del acceso' }).fill(MOTIVO_DE_ACCESO);
    await page.getByRole('button', { name: 'Ver la historia clinica' }).click();

    await expect(page.getByRole('heading', { name: sembrada.nombreCompleto })).toBeVisible();
    await expect(page.getByText(`Con motivo declarado: «${MOTIVO_DE_ACCESO}»`)).toBeVisible();

    const timeline = page.getByRole('list', { name: /Hechos clinicos/ });
    await expect(timeline.getByRole('button', { name: /Entrada clinica/ })).toBeVisible();
    await expect(timeline.getByRole('button', { name: /Adjunto clinico/ })).toBeVisible();
    // El indice no trae contenido: el texto de la entrada no esta en la lista.
    await expect(timeline).not.toContainText(TEXTO_DE_LA_ENTRADA);

    // La lectura quedo auditada con el motivo declarado.
    const auditadas = sql(
      `SELECT COUNT(*) FROM audit_event a JOIN organization o ON o.id = a.organization_id ` +
        `WHERE o.name='${sembrada.organizacion}' AND a.event_type='HISTORIA_CLINICA_ACCESSED' ` +
        `AND (a.reason LIKE '%${MOTIVO_DE_ACCESO}%' OR a.details LIKE '%${MOTIVO_DE_ACCESO}%')`,
    );
    expect(Number(auditadas), 'el acceso con motivo queda auditado').toBeGreaterThan(0);
  });

  test('abrir la entrada, enmendarla y ver las dos versiones', async ({ page }) => {
    await abrirHistoriaConMotivo(page, sembrada);

    await page.getByRole('button', { name: /Entrada clinica/ }).click();
    await expect(page.getByText(TEXTO_DE_LA_ENTRADA)).toBeVisible();

    await page.getByRole('button', { name: 'Enmendar' }).click();
    await page
      .getByRole('textbox', { name: 'Texto corregido' })
      .fill(`${TEXTO_DE_LA_ENTRADA} Irradia a pierna izquierda.`);
    // Sin motivo de enmienda, no se guarda.
    await page.getByRole('button', { name: 'Guardar enmienda' }).click();
    await expect(page.getByText(/Decí por que se corrige/)).toBeVisible();

    await page
      .getByRole('textbox', { name: 'Motivo de la enmienda' })
      .fill('Dato omitido en la primera carga');
    await page.getByRole('button', { name: 'Guardar enmienda' }).click();
    await expect(page.getByText('Enmendada')).toBeVisible();

    await page.getByRole('button', { name: 'Ver versiones' }).click();
    const versiones = page.getByRole('list', { name: /Versiones de la entrada/ });
    await expect(versiones.getByRole('listitem')).toHaveCount(2);
    await expect(versiones).toContainText('Dato omitido en la primera carga');
    await expect(versiones).toContainText('original');

    // La version 1 sigue en la base: enmendar no pisa.
    const filas = sql(
      `SELECT COUNT(*) FROM entrada_clinica_version WHERE entrada_clinica_id=${sembrada.entradaId}`,
    );
    expect(Number(filas)).toBe(2);
  });

  test('el adjunto se abre a pedido y la imagen se previsualiza', async ({ page }) => {
    await abrirHistoriaConMotivo(page, sembrada);

    await page.getByRole('button', { name: /Adjunto clinico/ }).click();
    // Elegir la fila no baja el archivo: abrirlo es una lectura aparte.
    await expect(page.getByRole('img', { name: /Vista previa/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Abrir el archivo' }).click();
    const previa = page.getByRole('img', { name: /Vista previa de/ });
    await expect(previa).toBeVisible();
    await expect(previa).toHaveAttribute('src', /^blob:/);
    await expect(page.getByRole('link', { name: 'Descargar' })).toHaveAttribute('download', /.+/);
  });

  test('registrar una entrada nueva la suma al timeline', async ({ page }) => {
    await abrirHistoriaConMotivo(page, sembrada);

    const timeline = page.getByRole('list', { name: /Hechos clinicos/ });
    await expect(timeline.getByRole('listitem')).toHaveCount(2);

    await page.getByText('Nueva entrada clinica').click();
    await page.getByRole('combobox', { name: 'Tipo de entrada' }).selectOption('INDICACION');
    await page
      .getByRole('textbox', { name: 'Texto', exact: true })
      .fill('Ejercicios de movilidad, 3 series diarias.');
    await page.getByRole('button', { name: 'Registrar entrada' }).click();

    await expect(timeline.getByRole('listitem')).toHaveCount(3);
    await expect(timeline.getByRole('button', { name: /Indicacion/ })).toBeVisible();
  });
});
