import { Locator, Page, test } from '@playwright/test';

import { nonce } from './support/akine';
import { ingresar, navegar } from './support/agenda-real';
import {
  CentroPropio,
  cerrarCentroPropio,
  expect,
  sembrarCentroPropio,
} from './support/centro-propio';
import {
  crearConvenio,
  crearFinanciador,
  crearOferta,
  crearPersona,
  darCobertura,
  diaDeTrabajo,
  fechaLocal,
  practicaGlobal,
  reservarElPrimeroLibre,
  sumarDias,
} from './support/sembrado';

/**
 * E2E de la ULTIMA unidad de una autorizacion consumida por dos cierres a la vez (04.05, DP-13),
 * contra el backend real.
 *
 * <p>Es el escenario que el cierre de F4 dejo escrito como "el que no puede faltar" y que hasta
 * ahora solo probaba un mock que devolvia cero filas: dos sesiones del mismo paciente, de la misma
 * practica, cerradas al mismo tiempo, contra una autorizacion de UNA unidad. La regla: se consume
 * una vez. Ni dos consumos (saldo negativo, se le declara al financiador una prestacion que no
 * autorizo), ni el ledger diciendo una cosa y el saldo otra.
 *
 * <p>Las dos sesiones cierran: quedarse sin unidades no frena la atencion clinica. Lo que se afirma
 * por la pantalla de autorizaciones del paciente es el saldo (Otorgadas 1, Consumidas 1,
 * Disponibles 0) y que el ledger tiene exactamente un consumo.
 *
 * <p>Centro propio (`support/centro-propio.ts`): la profesional cierra sesiones en paralelo.
 */
test.describe.configure({ mode: 'default' });

function dato(panel: Locator, termino: string): Locator {
  return panel
    .locator('dt', { hasText: new RegExp(`^${termino}$`) })
    .locator('xpath=following-sibling::dd[1]');
}

async function abrirElSaldo(page: Page, personaId: number, numero: string): Promise<Locator> {
  await navegar(page, `/pacientes/${personaId}/autorizaciones`);
  await page
    .getByRole('table', { name: /autorizacion\(es\) del paciente/ })
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: new RegExp(`^${numero}(\\s|$)`) }) })
    .getByRole('button', { name: 'Saldo y consumos' })
    .click();
  const panel = page.getByRole('region', { name: `Saldo y consumos de la autorización ${numero}` });
  await expect(panel.getByRole('heading', { name: 'Saldo', level: 3 })).toBeVisible();
  return panel;
}

test.describe('La ultima unidad de una autorizacion contra el backend real', () => {
  let propio: CentroPropio;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    propio = await sembrarCentroPropio('autorizacion');
  });

  test.afterAll(async () => {
    await cerrarCentroPropio(propio);
  });

  test('dos cierres simultaneos contra una unidad la consumen una sola vez', async ({ page }) => {
    test.slow();
    const { api, profesional, centro } = propio;
    const desde = sumarDias(fechaLocal(centro.timezone), -30);
    const sede = `/api/v1/consultorios/${centro.consultorioId}`;
    const numero = `AUT-${nonce()}`;

    const practicaId = await practicaGlobal(api, 'KIN_SESION');
    const oferta = await crearOferta(api, centro, {
      extra: { admiteObraSocial: true, precioBase: 12000, moneda: 'ARS' },
    });
    await api.exigir('PUT', `${sede}/ofertas/${oferta.id}/practicas`, {
      practicaIds: [practicaId],
      practicaPrincipalId: practicaId,
      expectedVersion: oferta.version,
    });
    const financiador = await crearFinanciador(api, desde);
    const convenio = await crearConvenio(api, centro, financiador, desde);
    await api.exigir('POST', `${sede}/convenios/${convenio.id}/aranceles`, {
      practicaId,
      importeTotal: 12000,
      importeFinanciador: 9600,
      coseguro: 2400,
      vigenciaDesde: desde,
    });
    const persona = await crearPersona(api);
    const coberturaId = await darCobertura(api, persona, financiador, desde);
    const autorizacion = await api.exigir<{ id: number }>(
      'POST',
      `/api/v1/personas/${persona.id}/autorizaciones`,
      {
        coberturaId,
        practicaId,
        numero,
        estadoInicial: 'APROBADA',
        cantidadAutorizada: 1,
        vigenciaDesde: desde,
        vigenciaHasta: sumarDias(desde, 180),
      },
    );

    // Dos turnos del mismo dia, las dos sesiones abiertas, y los dos cierres a la vez.
    const { slots } = await diaDeTrabajo(api, centro, oferta.id, 2);
    const turnos = [
      await reservarElPrimeroLibre(api, centro, oferta.id, persona.id, [slots[0]]),
      await reservarElPrimeroLibre(api, centro, oferta.id, persona.id, [slots[1]]),
    ];
    const sesiones: { id: number; version: number }[] = [];
    for (const turno of turnos) {
      sesiones.push(await profesional.exigir('POST', `${sede}/sesiones/turnos/${turno.id}`));
    }
    const cierres = await Promise.all(
      sesiones.map((sesion) =>
        profesional.pedir('POST', `${sede}/sesiones/${sesion.id}/cierre`, {
          asistencia: 'PRESENTE',
          notaDeCierre: 'Sesion sintetica de los E2E: cierre concurrente.',
          version: sesion.version,
        }),
      ),
    );
    for (const cierre of cierres) {
      // Quedarse sin unidades no frena la atencion: los dos cierres tienen que entrar.
      expect(cierre.status(), `cierre: ${await cierre.text()}`).toBeLessThan(300);
    }

    // El servidor: una sola unidad consumida, y el ledger dice lo mismo que el saldo.
    const leida = await api.exigir<{ cantidadAutorizada: number; cantidadConsumida: number }>(
      'GET',
      `/api/v1/personas/${persona.id}/autorizaciones/${autorizacion.id}`,
    );
    expect(leida.cantidadConsumida, JSON.stringify(leida)).toBe(1);

    // La pantalla: saldo y ledger.
    await ingresar(page, centro);
    const panel = await abrirElSaldo(page, persona.id, numero);
    await expect(dato(panel, 'Otorgadas')).toHaveText('1');
    await expect(dato(panel, 'Consumidas')).toHaveText('1');
    await expect(dato(panel, 'Disponibles')).toHaveText('0');
    const consumos = panel.locator('li').filter({ hasText: /Consumo #\d+/ });
    await expect(consumos).toHaveCount(1);
    await expect(consumos).toContainText('Resta 1 al saldo');
  });
});
