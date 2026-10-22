import * as nodeFs from 'node:fs';

import { Locator, Page } from '@playwright/test';

import { nonce } from './support/akine';
import { expect, ingresar, navegar, problemaDe, respuestaDe, test } from './support/agenda-real';
import { crearPersona, uriDeProblema } from './support/sembrado';

/**
 * E2E de los documentos de una persona (M07, AKINE-03.01) contra el backend REAL: subir un PDF por
 * pantalla, verlo en el listado y descargarlo igual; y que un texto con extension `.pdf` lo rechace
 * el servidor por el contenido.
 *
 * <p>El tipo se verifica por los primeros bytes en el backend, no por la extension: es lo que ningun
 * test unitario con `HttpTestingController` puede probar.
 */

/** El PDF valido mas chico que se puede armar: cabecera, un objeto y el fin de archivo. */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
  'latin1',
);

/** El panel de subida: la pantalla tiene otro selector "Categoria", el del filtro. */
function subidaDe(page: Page): Locator {
  return page.getByRole('region', { name: 'Subir un documento' });
}

test.describe('Documentos de la persona contra el backend real', () => {
  test('subir un PDF, descargarlo, y el texto disfrazado de PDF rechazado', async ({
    page,
    api,
    centro,
  }) => {
    const persona = await crearPersona(api);
    const titulo = `DNI escaneado ${nonce()}`;

    await ingresar(page, centro);
    await navegar(page, `/pacientes/${persona.id}/documentos`);

    // --- Subir un PDF de verdad ---------------------------------------------------------------
    await page.getByRole('button', { name: 'Subir un documento' }).click();
    await subidaDe(page)
      .getByLabel('Archivo')
      .setInputFiles({ name: 'dni.pdf', mimeType: 'application/pdf', buffer: PDF });
    await subidaDe(page).getByLabel('Categoría').selectOption({ value: 'DOCUMENTO_IDENTIDAD' });
    await subidaDe(page).getByLabel('Título').fill(titulo);
    const subida = respuestaDe(page, 'POST', /\/personas\/\d+\/adjuntos$/);
    await page.getByRole('button', { name: 'Subir', exact: true }).click();
    const creada = await subida;
    expect(creada.status(), await creada.text()).toBe(201);

    const fila = page.getByRole('row').filter({ hasText: titulo });
    await expect(fila).toContainText('dni.pdf');
    await expect(fila).toContainText('Vigente');

    // --- Descargarlo: los mismos bytes -----------------------------------------------------
    const descarga = page.waitForEvent('download');
    await fila.getByRole('button', { name: 'Descargar' }).click();
    const archivo = await descarga;
    expect(nodeFs.readFileSync((await archivo.path())!).equals(PDF)).toBe(true);

    // --- Un texto con extension .pdf: lo rechaza el servidor, por el contenido -------------
    await page.getByRole('button', { name: 'Subir un documento' }).click();
    await subidaDe(page)
      .getByLabel('Archivo')
      .setInputFiles({
        name: 'no-es-un.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('esto es texto plano, no un PDF\n'),
      });
    await subidaDe(page).getByLabel('Categoría').selectOption({ value: 'OTRO' });
    const rechazo = respuestaDe(page, 'POST', /\/personas\/\d+\/adjuntos$/);
    await page.getByRole('button', { name: 'Subir', exact: true }).click();
    const respuesta = await rechazo;
    expect(respuesta.status()).toBeGreaterThanOrEqual(400);
    expect((await problemaDe(respuesta)).type).toBe(uriDeProblema('archivo-no-aceptado'));
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'no-es-un.pdf' })).toHaveCount(0);
  });
});
