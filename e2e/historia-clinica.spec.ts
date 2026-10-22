import { expect, test } from '@playwright/test';

import { sql } from './support/akine';
import { navegar } from './support/agenda-real';
import { abrirFiltros } from './support/filtros';
import {
  HistoriaSembrada,
  MOTIVO_DE_ACCESO,
  TEXTO_DE_LA_ENTRADA,
  abrirHistoriaConMotivo,
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

test.describe('Historia clinica - timeline (D-a)', () => {
  // Se siembra UNA vez para el archivo: el alta esta limitada a 5 por minuto y cada sembrado da de
  // alta dos cuentas. Los tests no dependen del orden: el que cuenta hechos cuenta antes y despues.
  test.describe.configure({ mode: 'default', timeout: 120_000 });

  let sembrada: HistoriaSembrada;

  test.beforeAll(async ({ request }) => {
    // Dos altas por sembrado contra un limite de 5 por minuto: la espera de cupo puede ser larga.
    test.setTimeout(300_000);
    sembrada = await sembrarHistoria(request);
  });

  test('sin relacion asistencial pide motivo, y con el muestra cabecera y timeline', async ({
    page,
  }) => {
    await entrarConContexto(page, sembrada);
    await navegar(page, `/historia-clinica/personas/${sembrada.personaId}`);

    await expect(page.getByRole('heading', { name: 'Declara el motivo del acceso' })).toBeVisible();
    // Sin motivo no se manda nada: el campo obligatorio frena el envio.
    await page.getByRole('button', { name: 'Ver la historia clínica' }).click();
    await expect(page.getByText('Sin motivo no se puede seguir.')).toBeVisible();

    await page.getByRole('textbox', { name: 'Motivo del acceso' }).fill(MOTIVO_DE_ACCESO);
    await page.getByRole('button', { name: 'Ver la historia clínica' }).click();

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
    await expect(timeline.getByRole('listitem').first()).toBeVisible();
    const antes = await timeline.getByRole('listitem').count();

    await page.getByText('Nueva entrada clínica').click();
    await page.getByRole('combobox', { name: 'Tipo de entrada' }).selectOption('INDICACION');
    await page
      .getByRole('textbox', { name: 'Texto', exact: true })
      .fill('Ejercicios de movilidad, 3 series diarias.');
    await page.getByRole('button', { name: 'Registrar entrada' }).click();

    await expect(timeline.getByRole('listitem')).toHaveCount(antes + 1);
    await expect(timeline.getByRole('button', { name: /Indicacion/ })).toBeVisible();
  });

  test('los filtros de origen y de fechas los resuelve el servidor y viajan en cada pagina', async ({
    page,
  }) => {
    await abrirHistoriaConMotivo(page, sembrada);
    const timeline = page.getByRole('list', { name: /Hechos clinicos/ });
    await expect(timeline.getByRole('button', { name: /Entrada clinica/ }).first()).toBeVisible();

    // Solo adjuntos: el servidor recibe el origen y no devuelve entradas.
    await abrirFiltros(page);
    const filtrada = page.waitForResponse(
      (r) => r.url().includes('/timeline') && r.url().includes('origen=ADJUNTO_CLINICO'),
    );
    await page.getByRole('checkbox', { name: 'Adjuntos' }).check();
    expect((await filtrada).status()).toBe(200);
    await expect(timeline.getByRole('button', { name: /Adjunto clinico/ })).toBeVisible();
    await expect(timeline.getByRole('button', { name: /Entrada clinica/ })).toHaveCount(0);

    // Un rango que empieza en el futuro no trae nada, con el mensaje de los filtros.
    const conRango = page.waitForResponse(
      (r) => r.url().includes('/timeline') && r.url().includes('desde='),
    );
    await page.getByLabel('Desde el día').fill('2099-01-01');
    expect((await conRango).status()).toBe(200);
    await expect(page.getByText('Ningún hecho clínico coincide con los filtros.')).toBeVisible();

    // Un rango invertido no sale: el backend lo rechazaria con 400.
    await page.getByLabel('Hasta el día (inclusive)').fill('2098-12-31');
    await expect(page.getByText(/tiene que ser el mismo dia que/)).toBeVisible();

    await page.getByRole('button', { name: 'Quitar los filtros' }).click();
    await expect(timeline.getByRole('button', { name: /Entrada clinica/ }).first()).toBeVisible();
    await expect(timeline.getByRole('button', { name: /Adjunto clinico/ })).toBeVisible();
  });
});
