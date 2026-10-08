import { expect, abrirReserva, ingresar, navegar, test } from './support/agenda-real';
import {
  ApiAkine,
  Centro,
  DIAS,
  Oferta,
  Persona,
  Slot,
  agendaDe,
  crearOferta,
  crearPersona,
  fechaLocal,
  sumarDias,
  uriDeProblema,
} from './support/sembrado';

/**
 * E2E de las series de turnos (E-3 alta y detalle, E-8 bandeja) contra el backend REAL:
 * previsualizar → reservar la serie → encontrarla en `/agenda/series` → abrirla → cancelar
 * "este y los siguientes".
 *
 * <p>Una serie ocupa al profesional del centro el MISMO dia de la semana durante tres semanas, asi
 * que trabaja en su propio bloque ({@link DIAS}.serie) y elige un inicio cuyas tres ocurrencias
 * tengan lugar: un feriado en el medio haria que la previsualizacion marque "Sin lugar", que es el
 * producto funcionando y no lo que este test mira.
 */

const OCURRENCIAS = 3;

interface TurnoDeSerie {
  readonly id: number;
  readonly inicio: string;
  readonly estado: string;
}

/** El primer dia del bloque cuyo mismo horario tiene lugar las tres semanas seguidas. */
async function inicioDeLaSerie(
  api: ApiAkine,
  centro: Centro,
  oferta: Oferta,
): Promise<{ fecha: string; slot: Slot }> {
  const primero = fechaLocal(centro.timezone, DIAS.serie);
  for (let corrimiento = 0; corrimiento < 7; corrimiento++) {
    const fecha = sumarDias(primero, corrimiento);
    const [dia] = await agendaDe(api, centro, oferta.id, fecha);
    // El ultimo slot del dia: lejos de los primeros, que son los que eligen los demas tests.
    const slot = dia.slots.at(-1);
    if (slot === undefined) {
      continue;
    }
    let todas = true;
    for (let semana = 1; semana < OCURRENCIAS && todas; semana++) {
      const [siguiente] = await agendaDe(api, centro, oferta.id, sumarDias(fecha, 7 * semana));
      const hora = slot.desde.slice(11);
      todas = siguiente.slots.some((s) => s.desde.slice(11) === hora);
    }
    if (todas) {
      return { fecha, slot };
    }
  }
  throw new Error(`ningun dia desde ${primero} tiene lugar ${OCURRENCIAS} semanas seguidas`);
}

test.describe('Series de turnos contra el backend real', () => {
  let oferta: Oferta;
  let persona: Persona;

  test.beforeEach(async ({ page, api, centro }) => {
    oferta = await crearOferta(api, centro);
    persona = await crearPersona(api);
    await ingresar(page, centro);
  });

  test('alta con previsualizacion, bandeja, detalle y cancelar este y los siguientes', async ({
    page,
    api,
    centro,
  }) => {
    const { fecha, slot } = await inicioDeLaSerie(api, centro, oferta);

    // Se llega como llega el mostrador: desde la reserva de un slot, por su enlace de serie.
    await abrirReserva(page, oferta, fecha, slot, persona);
    await page.getByRole('link', { name: 'Reservar una serie semanal desde este horario' }).click();
    await expect(
      page.getByRole('heading', { name: 'Reservar una serie de turnos', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(oferta.nombre)).toBeVisible();

    // La pantalla de la serie es otra: la persona se vuelve a elegir.
    await page.getByLabel('Documento, apellido, nombre o telefono').fill(persona.apellido);
    await page.getByRole('button', { name: `${persona.apellido}, ${persona.nombre}` }).click();

    const cantidad = page.getByLabel(/Cantidad de turnos/);
    await cantidad.fill(String(OCURRENCIAS));
    await cantidad.blur();

    await page.getByRole('button', { name: 'Previsualizar los turnos' }).click();
    const prevista = page.getByRole('region', { name: 'Turnos de la serie' });
    await expect(prevista.getByText('Libre', { exact: true })).toHaveCount(OCURRENCIAS);
    await expect(
      page.getByRole('heading', { name: new RegExp(`^${OCURRENCIAS} turnos`) }),
    ).toBeVisible();

    await page.getByRole('button', { name: `Reservar los ${OCURRENCIAS} turnos` }).click();
    await expect(page.getByRole('heading', { name: 'Serie reservada' })).toBeVisible();
    await expect(page.getByText(`Se reservaron ${OCURRENCIAS} turnos.`)).toBeVisible();

    // La bandeja de la sede (E-8) la lista, filtrada por el paciente.
    await navegar(page, '/agenda/series');
    await expect(page.getByRole('heading', { name: 'Series de turnos', level: 1 })).toBeVisible();
    await page
      .getByLabel('Paciente: documento, apellido, nombre o telefono')
      .fill(persona.apellido);
    await page.getByRole('button', { name: `${persona.apellido}, ${persona.nombre}` }).click();
    await expect(page.getByRole('heading', { name: '1 serie' })).toBeVisible();
    const fila = page.getByRole('region', { name: 'Series de turnos de la sede' }).getByRole('row');
    await expect(fila.filter({ hasText: oferta.nombre })).toContainText(
      `${OCURRENCIAS} pendientes de ${OCURRENCIAS}`,
    );
    await fila
      .filter({ hasText: oferta.nombre })
      .getByRole('link', { name: /Ver serie/ })
      .click();

    // Detalle: cancelar desde el segundo turno se lleva el segundo y el tercero.
    await expect(page.getByRole('heading', { name: 'Serie de turnos', level: 1 })).toBeVisible();
    const turnos = page.getByRole('region', { name: 'Turnos de la serie' }).locator('tbody tr');
    await expect(turnos).toHaveCount(OCURRENCIAS);
    const serieId = Number(new URL(page.url()).pathname.split('/').at(-1));

    await turnos
      .nth(1)
      .getByRole('button', { name: /Cancelar este y los siguientes/ })
      .click();
    await expect(page.getByText('Se cancelarian estos 2 turnos:')).toBeVisible();
    await page.getByLabel('Motivo de la cancelacion').fill('El paciente termino el tratamiento');
    await page.getByRole('button', { name: 'Cancelar 2 turnos' }).click();
    await expect(page.getByText('Se cancelaron 2 turnos.')).toBeVisible();

    await expect(turnos.nth(0)).toContainText('Reservado');
    await expect(turnos.nth(1)).toContainText('Cancelado');
    await expect(turnos.nth(2)).toContainText('Cancelado');

    const guardada = await api.exigir<{ turnos: TurnoDeSerie[] }>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/series-de-turnos/${serieId}`,
    );
    expect(guardada.turnos.map((t) => t.estado)).toEqual(['RESERVADO', 'CANCELADO', 'CANCELADO']);

    // Repetir la misma cancelacion ya no encuentra nada pendiente en ese alcance.
    const repetida = await api.pedir(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/series-de-turnos/${serieId}/cancelacion`,
      {
        alcance: 'ESTE_Y_SIGUIENTES',
        turnoId: guardada.turnos[1].id,
        motivo: 'Otra vez',
        cantidadConfirmada: 2,
      },
    );
    expect(repetida.status(), await repetida.text()).toBe(409);
    expect(((await repetida.json()) as { type: string }).type).toBe(
      uriDeProblema('turno-transicion-no-permitida'),
    );
  });
});
