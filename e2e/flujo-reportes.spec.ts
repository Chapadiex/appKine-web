import * as nodeFs from 'node:fs';

import { expect, ingresar, navegar, test } from './support/agenda-real';
import {
  crearOferta,
  crearPersona,
  diaDeTrabajo,
  reservarElPrimeroLibre,
} from './support/sembrado';
import { DIAS_INVENTARIO, cancelarTurno, leerCsv } from './support/sembrado-inventario';

/**
 * E2E del tablero de reportes (G-8, M23) contra el backend REAL: generar el reporte de Turnos de un
 * dia por pantalla y descargar su CSV.
 *
 * <p>El dia es del bloque propio de este spec ({@link DIAS_INVENTARIO}.reporte): nadie mas reserva
 * ahi, asi que los numeros son exactos. Se reservan dos turnos y se cancela uno: el reporte tiene que
 * decir 2 turnos, 1 reservado y 1 cancelado —en la pantalla, con fuente y fecha de corte, y en el
 * CSV—, que es lo que ningun test unitario con `HttpTestingController` podia afirmar.
 */
test.describe('Reportes contra el backend real', () => {
  test('el reporte de turnos de un dia cuenta lo reservado y lo cancelado, y se descarga en CSV', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const { fecha, slots } = await diaDeTrabajo(api, centro, oferta.id, DIAS_INVENTARIO.reporte);
    const persona = await crearPersona(api);
    const queda = await reservarElPrimeroLibre(api, centro, oferta.id, persona.id, slots);
    const cancelado = await reservarElPrimeroLibre(
      api,
      centro,
      oferta.id,
      persona.id,
      slots.filter((s) => s.desde !== queda.inicio),
    );
    await cancelarTurno(api, centro, cancelado, 'El paciente aviso que no viene');

    await ingresar(page, centro);
    await navegar(page, '/reportes');
    await expect(page.getByRole('heading', { name: 'Reportes', level: 1 })).toBeVisible();
    await page.getByLabel('Reporte', { exact: true }).selectOption({ label: 'Turnos' });
    await page.getByLabel('Desde', { exact: true }).fill(fecha);
    await page.getByLabel('Hasta', { exact: true }).fill(fecha);

    const generado = page.waitForResponse(
      (r) => /\/reportes\/TURNOS$/.test(new URL(r.url()).pathname) && r.status() === 200,
    );
    await page.getByRole('button', { name: 'Generar reporte' }).click();
    await generado;

    const indicador = (etiqueta: string) =>
      page.locator('li.indicador').filter({
        has: page.locator('.indicador__etiqueta', { hasText: new RegExp(`^${etiqueta}$`) }),
      });
    await expect(indicador('Turnos').locator('.indicador__valor')).toHaveText('2');
    await expect(indicador('Reservados').locator('.indicador__valor')).toHaveText('1');
    await expect(indicador('Cancelados').locator('.indicador__valor')).toHaveText('1');
    // Cada numero dice de donde sale: fuente y fecha de corte, del servidor.
    await expect(indicador('Turnos').getByText('Fuente')).toBeVisible();
    await expect(indicador('Turnos').getByText('Fecha de corte')).toBeVisible();
    const detalle = page.getByRole('region', { name: /^Detalle de / });
    await expect(detalle.getByRole('row').filter({ hasText: 'CANCELADO' })).toContainText('1');
    await expect(detalle.getByRole('row').filter({ hasText: 'RESERVADO' })).toContainText('1');

    // --- CSV con los mismos filtros ---------------------------------------------------------
    const descarga = page.waitForEvent('download');
    const pedido = page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith('/reportes/TURNOS/export'),
    );
    await page.getByRole('button', { name: 'Descargar CSV' }).click();
    const respuesta = await pedido;
    expect(respuesta.status()).toBe(200);
    expect(respuesta.request().headers()['accept']).toContain('text/csv');
    const consulta = new URL(respuesta.url()).searchParams;
    expect(consulta.get('desde')).toBe(fecha);
    expect(consulta.get('hasta')).toBe(fecha);

    const archivo = await descarga;
    expect(archivo.suggestedFilename()).toBe(`reporte-turnos-${fecha}-a-${fecha}.csv`);
    const filas = leerCsv(nodeFs.readFileSync((await archivo.path())!, 'utf8'));
    expect(filas).toContainEqual(['Reporte', 'TURNOS']);
    expect(filas).toContainEqual(['Desde', fecha]);
    expect(filas).toContainEqual(['Hasta', fecha]);
    const valorDe = (etiqueta: string) => filas.find((f) => f[0] === etiqueta)?.[1];
    expect(valorDe('Turnos')).toBe('2');
    expect(valorDe('Reservados')).toBe('1');
    expect(valorDe('Cancelados')).toBe('1');
    expect(filas).toContainEqual([fecha, 'CANCELADO', '1']);
  });
});
