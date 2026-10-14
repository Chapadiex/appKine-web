import * as nodeFs from 'node:fs';

import { expect, ingresar, navegar, test } from './support/agenda-real';
import { ApiAkine, Obligacion, comoProfesional, fechaLocal, sumarDias } from './support/sembrado';
import { DIAS_PANTALLAS_098, sembrarPrestacionFinanciada } from './support/sembrado-pantallas-098';

/**
 * E2E de "Exportar CSV" en el detalle de un lote de presentacion (web #74, api #108) contra el
 * backend REAL.
 *
 * <p>La deuda del financiador sale del camino de produccion (convenio + arancel + cobertura, sesion
 * cerrada por la profesional). El lote se arma y se confirma por la API —ese recorrido ya lo cubre
 * `flujo-presentaciones`— y lo que se prueba aca es el boton: que la descarga ocurra, con el nombre
 * que manda el servidor en `Content-Disposition`, y que el archivo traiga el lote y sus prestaciones
 * SIN el nombre del paciente (PHI minima, RNF-M21-001: cada fila lleva el `personaId`).
 */

const IMPORTES = { total: 12000, financiador: 9600, coseguro: 2400 };

/** Filas del CSV (RFC 4180: celdas entre comillas, `""` es una comilla), sin las lineas vacias. */
function leerCsv(texto: string): string[][] {
  return texto
    .split('\r\n')
    .filter((linea) => linea !== '')
    .map((linea) =>
      [...linea.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)].map((m) =>
        m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2],
      ),
    );
}

test.describe('Exportar una presentacion a CSV contra el backend real', () => {
  let profesional: ApiAkine;

  test.beforeAll(async ({ centro }) => {
    profesional = await comoProfesional(centro);
  });

  test.afterAll(async () => {
    await profesional.cerrar();
  });

  test('el boton descarga el lote con su nombre, sus prestaciones y sin nombres de pacientes', async ({
    page,
    api,
    centro,
  }) => {
    test.slow();
    const sede = `/api/v1/consultorios/${centro.consultorioId}`;
    const hoy = fechaLocal(centro.timezone);
    const sembrado = await sembrarPrestacionFinanciada(
      api,
      profesional,
      centro,
      DIAS_PANTALLAS_098.presentacionCsv,
      IMPORTES,
    );
    const desde = sumarDias(hoy, -1);
    const hasta = sumarDias(hoy, 1);
    const elegibles = await api.exigir<Obligacion[]>(
      'GET',
      `${sede}/prestaciones-elegibles?financiadorId=${sembrado.financiador.id}&desde=${desde}&hasta=${hasta}`,
    );
    const deuda = elegibles.find((d) => d.personaId === sembrado.persona.id);
    expect(deuda, 'el cierre devengo la deuda del financiador').toBeDefined();

    const borrador = await api.exigir<{ id: number }>('POST', `${sede}/presentaciones`, {
      financiadorId: sembrado.financiador.id,
      moneda: 'ARS',
      periodoDesde: desde,
      periodoHasta: hasta,
      obligacionIds: [deuda!.id],
    });
    const lote = await api.exigir<{ id: number; numero: number }>(
      'POST',
      `${sede}/presentaciones/${borrador.id}/confirmacion`,
    );
    expect(lote.numero, 'confirmar le asigna numero al lote').toBeGreaterThan(0);

    // --- La pantalla descarga el archivo ---------------------------------------------------
    await ingresar(page, centro);
    await navegar(page, `/presentaciones/${lote.id}`);
    await expect(
      page.getByRole('heading', {
        name: `Lote N.º ${lote.numero} a ${sembrado.financiador.nombre}`,
        level: 1,
      }),
    ).toBeVisible();

    const descarga = page.waitForEvent('download');
    const pedido = page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith(`/presentaciones/${lote.id}/export`),
    );
    await page.getByRole('button', { name: 'Exportar CSV' }).click();
    const respuesta = await pedido;
    expect(respuesta.status()).toBe(200);
    expect(respuesta.request().headers()['accept']).toContain('text/csv');

    const archivo = await descarga;
    // El nombre es el del servidor (`Content-Disposition`), no el respaldo de la pantalla.
    expect(archivo.suggestedFilename()).toBe(
      `presentacion-${sembrado.financiador.id}-${lote.numero}.csv`,
    );
    const ruta = await archivo.path();
    const csv = nodeFs.readFileSync(ruta, 'utf8');

    // --- El contenido: el lote y su prestacion ----------------------------------------------
    const filas = leerCsv(csv);
    const cabecera = new Map(filas.filter((f) => f.length === 2).map(([k, v]) => [k, v]));
    expect(cabecera.get('Presentacion')).toBe(String(lote.id));
    expect(cabecera.get('Numero')).toBe(String(lote.numero));
    expect(cabecera.get('Financiador')).toBe(sembrado.financiador.nombre);
    expect(cabecera.get('Estado')).toBe('PRESENTADA');
    expect(cabecera.get('Total presentado')).toBe('9600.00');
    const columnas = filas.find((f) => f[0] === 'Item');
    expect(columnas, `el CSV trae la tabla de prestaciones:\n${csv}`).toBeDefined();
    const items = filas.slice(filas.indexOf(columnas!) + 1).filter((f) => f.length > 1);
    expect(items).toHaveLength(1);
    const item = Object.fromEntries(columnas!.map((c, i) => [c, items[0][i]]));
    expect(item['Obligacion']).toBe(String(deuda!.id));
    expect(item['Sesion']).toBe(String(sembrado.sesionId));
    expect(item['Persona']).toBe(String(sembrado.persona.id));
    expect(item['Importe presentado']).toBe('9600.00');

    // --- Y nada que identifique al paciente por nombre --------------------------------------
    expect(csv).not.toContain(sembrado.persona.apellido);
    expect(csv).not.toContain(sembrado.persona.nombre);
  });
});
