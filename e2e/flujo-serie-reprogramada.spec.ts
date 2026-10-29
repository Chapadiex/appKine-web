import { abrirAcciones } from './support/filtros';
import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { crearOferta, crearPersona, hora, rango, sumarDias } from './support/sembrado';
import { diaIso } from './support/sembrado-configuracion';
import { DIAS_INVENTARIO, inicioDeSerieConDestino } from './support/sembrado-inventario';

/**
 * E2E de reprogramar una serie con alcance (E-3, #34) contra el backend REAL: la serie de tres
 * semanas nace por la API, y desde su detalle se mueve "este turno y los siguientes" a otro horario
 * del mismo dia, con previsualizacion.
 *
 * <p>`flujo-series` cubre el alta y la cancelacion con alcance; la reprogramacion no tenia ningun
 * E2E. Lo que se afirma es lo que el servidor decide: cuantos se mueven, que el primero queda donde
 * estaba y que los otros dos quedan RESERVADOS en el horario nuevo, cada uno con su numero.
 */
const OCURRENCIAS = 3;

interface TurnoDeSerie {
  readonly id: number;
  readonly inicio: string;
  readonly estado: string;
}

test.describe('Reprogramar una serie contra el backend real', () => {
  test('mover este turno y los siguientes a otro horario, con previsualizacion', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const persona = await crearPersona(api);
    const { fecha, slot, destino } = await inicioDeSerieConDestino(
      api,
      centro,
      oferta,
      DIAS_INVENTARIO.serieReprogramada,
      OCURRENCIAS,
    );
    const sede = `/api/v1/consultorios/${centro.consultorioId}`;
    const serie = await api.exigir<{ id: number }>('POST', `${sede}/series-de-turnos`, {
      ofertaId: oferta.id,
      personaId: persona.id,
      profesionalId: slot.profesionalId,
      diasSemana: [diaIso(fecha)],
      fechaDesde: fecha,
      hora: hora(slot.desde, centro.timezone),
      cantidad: OCURRENCIAS,
    });
    const antes = await api.exigir<{ turnos: TurnoDeSerie[] }>(
      'GET',
      `${sede}/series-de-turnos/${serie.id}`,
    );
    expect(antes.turnos).toHaveLength(OCURRENCIAS);

    await ingresar(page, centro);
    await navegar(page, `/agenda/series/${serie.id}`);
    await expect(page.getByRole('heading', { name: 'Serie de turnos', level: 1 })).toBeVisible();
    const turnos = page.getByRole('region', { name: 'Turnos de la serie' }).locator('tbody tr');
    await expect(turnos).toHaveCount(OCURRENCIAS);

    // Desde el segundo turno: el alcance por defecto es "solo este", se cambia a "y los siguientes".
    await abrirAcciones(turnos.nth(1));
    await turnos
      .nth(1)
      .getByRole('button', { name: /^Reprogramar/ })
      .click();
    await expect(
      page.getByRole('heading', { name: /^Reprogramar desde el turno del / }),
    ).toBeVisible();
    await page.getByLabel('Este turno y los siguientes').check();
    await expect(page.getByText('Se moverian estos 2 turnos:')).toBeVisible();

    // Mismo dia, el horario libre de al lado: el selector arranca en el dia del turno de partida.
    await expect(page.getByLabel('Día destino')).toHaveValue(sumarDias(fecha, 7));
    const horaDestino = hora(destino.desde, centro.timezone);
    await page
      .getByRole('button', { name: new RegExp(`^${rango(destino, centro.timezone)}`) })
      .click();
    await page.getByLabel('Motivo del cambio').fill('El paciente pidio una hora antes');

    const movida = respuestaDe(page, 'POST', /\/series-de-turnos\/\d+\/reprogramacion$/);
    await page.getByRole('button', { name: 'Mover 2 turnos' }).click();
    const respuesta = await movida;
    expect(respuesta.status(), await respuesta.text()).toBeLessThan(300);
    // UX-12: el resultado es un aviso global, en la region de notificaciones.
    await expect(
      page.getByRole('region', { name: 'Notificaciones' }).getByText('Se movieron 2 turnos'),
    ).toBeVisible();

    // --- Lo que guardo el servidor ----------------------------------------------------------
    const despues = await api.exigir<{ turnos: TurnoDeSerie[] }>(
      'GET',
      `${sede}/series-de-turnos/${serie.id}`,
    );
    const porId = new Map(despues.turnos.map((t) => [t.id, t]));
    const [primero, segundo, tercero] = antes.turnos.map((t) => porId.get(t.id));
    expect(primero?.inicio, 'el primero no se mueve').toBe(antes.turnos[0].inicio);
    for (const movido of [segundo, tercero]) {
      expect(movido?.estado).toBe('RESERVADO');
      expect(hora(movido!.inicio, centro.timezone)).toBe(horaDestino);
    }
  });
});
