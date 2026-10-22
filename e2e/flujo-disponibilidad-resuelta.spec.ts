import { nonce } from './support/akine';
import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { fechaLocal, sumarDias } from './support/sembrado';

/**
 * E2E de las dos pantallas que RESUELVEN disponibilidad en vez de editarla, contra el backend REAL:
 * espacios en servicio en un periodo (`/espacios/disponibilidad`, M04) y el horario efectivo de un
 * profesional (`/horarios/efectivo`, M05).
 *
 * <p>Ninguna de las dos escribe nada; lo que se prueba es que la pantalla pinte lo que el servidor
 * resolvio: un espacio cuya vigencia termina dentro del periodo no esta "en servicio" durante todo
 * el periodo, y los dias con atencion son los que el servidor dice, con su zona.
 */
test.describe('Disponibilidad resuelta contra el backend real', () => {
  test('espacios en servicio: entra el que cubre el periodo entero, no el que vence en el medio', async ({
    page,
    api,
    centro,
  }) => {
    const sede = `/api/v1/organizations/${centro.organizationId}/consultorios/${centro.consultorioId}`;
    const desde = fechaLocal(centro.timezone, 30);
    const hasta = sumarDias(desde, 6);
    const entero = `Gimnasio E2E ${nonce()}`;
    const vence = `Gabinete E2E ${nonce()}`;
    await api.exigir('POST', `${sede}/espacios`, { name: entero, tipo: 'GIMNASIO', capacidad: 6 });
    await api.exigir('POST', `${sede}/espacios`, {
      name: vence,
      tipo: 'GABINETE',
      capacidad: 1,
      // Instante UTC, exclusivo: deja de estar en servicio a mitad del periodo consultado.
      validUntil: `${sumarDias(desde, 2)}T12:00:00Z`,
    });

    await ingresar(page, centro);
    await navegar(page, '/espacios/disponibilidad');
    await expect(
      page.getByRole('heading', { name: 'Espacios en servicio', level: 1 }),
    ).toBeVisible();
    // `datetime-local`: la pantalla lo lee en la zona del NAVEGADOR (ver el reporte del PR). Las
    // vigencias de arriba caen lejos de los bordes, asi que el resultado no depende de eso.
    await page.getByLabel('Desde').fill(`${desde}T12:00`);
    await page.getByLabel('Hasta').fill(`${hasta}T12:00`);
    const consulta = respuestaDe(page, 'GET', /\/espacios\/availability$/);
    await page.getByRole('button', { name: 'Ver que espacios hay' }).click();
    expect((await consulta).status()).toBe(200);

    const tabla = page.getByRole('region', {
      name: 'Espacios en servicio en el periodo consultado',
    });
    await expect(tabla.getByRole('row', { name: new RegExp(entero) })).toContainText(
      '6 personas a la vez',
    );
    await expect(tabla.getByRole('row', { name: new RegExp(vence) })).toHaveCount(0);
  });

  test('horario efectivo: los dias con atencion son los que resuelve el servidor', async ({
    page,
    api,
    centro,
  }) => {
    const desde = fechaLocal(centro.timezone, 40);
    const hasta = sumarDias(desde, 7);
    const resuelto = await api.exigir<{
      timezone: string;
      dias: { fecha: string; franjas?: unknown[] }[];
    }>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/profesionales/${centro.profesional.membershipId}/disponibilidad/efectiva?desde=${desde}&hasta=${hasta}`,
    );
    const conAtencion = resuelto.dias.filter((d) => (d.franjas?.length ?? 0) > 0).length;
    expect(resuelto.dias).toHaveLength(7);

    await ingresar(page, centro);
    await navegar(page, '/horarios/efectivo');
    await expect(
      page.getByRole('heading', { name: 'Horario del profesional', level: 1 }),
    ).toBeVisible();
    await page
      .getByLabel('Profesional')
      .selectOption({ value: String(centro.profesional.membershipId) });
    await page.getByLabel('Desde').fill(desde);
    await page.getByLabel('Hasta (exclusivo)').fill(hasta);
    const consulta = respuestaDe(page, 'GET', /\/disponibilidad\/efectiva$/);
    await page.getByRole('button', { name: 'Resolver el horario' }).click();
    expect((await consulta).status()).toBe(200);

    await expect(page.getByText(`${conAtencion} de 7 días con atención.`)).toBeVisible();
    await expect(page.getByText(resuelto.timezone, { exact: true })).toBeVisible();
    await expect(page.locator('tr.dia-efectivo')).toHaveCount(7);
    await expect(page.locator('tr.dia-efectivo:not(.dia-efectivo--vacio)')).toHaveCount(
      conAtencion,
    );
  });
});
