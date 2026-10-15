import { expect, ingresar, navegar, test } from './support/agenda-real';

/**
 * E2E de "hoy" en la zona de la SEDE y no del navegador (web #60) contra el backend REAL.
 *
 * <p>El reloj del navegador se fija a las 23:30 del ULTIMO dia del mes anterior en Cordoba, y el
 * navegador corre en Kiritimati (UTC+14), donde ya es el dia 1 del mes en curso a las 16:30. Es el
 * peor caso: no solo cambia el dia, cambia el MES. Con el "hoy" del navegador el reporte del mes
 * arrancaria en el mes equivocado y el filtro de convenios consultaria un dia que la sede todavia no
 * vivio.
 *
 * <p>El instante se calcula desde la zona real de la sede (la que devolvio el backend al sembrar),
 * no se asume Cordoba: el test verifica primero que el navegador y la sede esten en dias distintos.
 *
 * <p>El reloj se fija DESPUES de ingresar: el login y el refresh van contra el reloj real del
 * backend, y lo que se prueba es la fecha que la pantalla propone, no la sesion.
 */

const ZONA_DEL_NAVEGADOR = 'Pacific/Kiritimati';

test.use({ timezoneId: ZONA_DEL_NAVEGADOR });

function fechaEn(zona: string, instante: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

/** 23:30 del ultimo dia del mes anterior en la zona de la sede (busca el minuto que lo cumple). */
function casiMedianocheDeFinDeMes(zona: string): Date {
  const ahora = new Date();
  const primeroUtc = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1);
  // La zona de la sede esta entre UTC-12 y UTC+14: se recorre esa ventana de a 30 minutos.
  for (let delta = -14 * 60; delta <= 12 * 60; delta += 30) {
    const candidato = new Date(primeroUtc + delta * 60_000);
    const hora = new Intl.DateTimeFormat('en-GB', {
      timeZone: zona,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(candidato);
    const dia = fechaEn(zona, candidato);
    if (
      hora === '23:30' &&
      dia.slice(8) !== '01' &&
      fechaEn(zona, new Date(candidato.getTime() + 3_600_000)).endsWith('-01')
    ) {
      return candidato;
    }
  }
  throw new Error(`no se encontro las 23:30 de fin de mes en ${zona}`);
}

test.describe('El dia de la sede, con el navegador en otra zona y cerca de medianoche', () => {
  test('el reporte y los convenios proponen el dia (y el mes) de la sede', async ({
    page,
    centro,
  }) => {
    const instante = casiMedianocheDeFinDeMes(centro.timezone);
    const hoyDeLaSede = fechaEn(centro.timezone, instante);
    const hoyDelNavegador = fechaEn(ZONA_DEL_NAVEGADOR, instante);
    expect(hoyDelNavegador, 'precondicion: el navegador ya esta en otro dia').not.toBe(hoyDeLaSede);
    expect(hoyDelNavegador.slice(0, 7), 'y en otro mes').not.toBe(hoyDeLaSede.slice(0, 7));

    await ingresar(page, centro);
    await page.clock.setFixedTime(instante);
    expect(await page.evaluate(() => new Date().getDate())).toBe(Number(hoyDelNavegador.slice(8)));

    await navegar(page, '/reportes');
    await expect(page.getByLabel('Hasta')).toHaveValue(hoyDeLaSede);
    await expect(page.getByLabel('Desde')).toHaveValue(`${hoyDeLaSede.slice(0, 7)}-01`);

    await navegar(page, '/contratacion/convenios');
    await expect(page.locator('#filtro-fecha-convenio')).toHaveValue(hoyDeLaSede);
    await page.getByRole('button', { name: 'Firmar un convenio' }).click();
    await expect(page.getByLabel('Vigente desde')).toHaveValue(hoyDeLaSede);

    // Los `datetime-local` hablan en hora de la SEDE: la ventana propuesta arranca "ahora", que en
    // la sede son las 23:30 del ultimo dia del mes y en el navegador las 16:30 del dia 1.
    await navegar(page, '/espacios/disponibilidad');
    await expect(page.locator('#ventana-desde')).toHaveValue(`${hoyDeLaSede}T23:30`);
  });
});
