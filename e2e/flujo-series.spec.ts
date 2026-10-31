import { cerrarAvisos } from './support/avisos';
import { abrirAcciones } from './support/filtros';
import {
  abrirProgramacion,
  avisos,
  expect,
  ingresar,
  navegar,
  panelDeTurno,
  previsualizarSerie,
  respuestaDe,
  test,
} from './support/agenda-real';
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
  hora,
  sumarDias,
  uriDeProblema,
} from './support/sembrado';

/**
 * E2E de las series de turnos (E-3 alta y detalle, E-8 bandeja) contra el backend REAL:
 * "Programar varias sesiones" en el panel → previsualizar → confirmar → encontrarla en
 * `/agenda/series` → abrirla → cancelar "este y los siguientes".
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

    // Se llega como llega el mostrador: desde "Nuevo turno", con persona y prestacion ya elegidas.
    const panel = await abrirProgramacion(page, oferta, persona);
    await previsualizarSerie(panel, fecha, hora(slot.desde, centro.timezone), OCURRENCIAS);
    await expect(panel.getByRole('cell', { name: 'Disponible', exact: true })).toHaveCount(
      OCURRENCIAS,
    );

    const alta = respuestaDe(page, 'POST', /\/series-de-turnos$/);
    await panel.getByRole('button', { name: `Confirmar ${OCURRENCIAS} turnos` }).click();
    const respuesta = await alta;
    expect(respuesta.status(), await respuesta.text()).toBe(201);
    await expect(
      avisos(page).getByText(`${OCURRENCIAS} turnos creados correctamente.`),
    ).toBeVisible();
    await expect(panel).toBeHidden();
    await cerrarAvisos(page);

    // La bandeja de la sede (E-8) la lista, buscada por el paciente en el servidor (DP-45, `q`).
    await navegar(page, '/agenda/series');
    await expect(page.getByRole('heading', { name: 'Series de turnos', level: 1 })).toBeVisible();
    const busqueda = page.getByLabel('Paciente, documento, oferta o profesional');
    await busqueda.fill(persona.apellido);
    await busqueda.press('Enter');
    // El contador vive en la toolbar del listado, en la fila de la busqueda (UX-14 §1).
    await expect(page.locator('.filtros-barra__resultados')).toHaveText('1 serie');
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

    // "Ver o mover" abre el panel del turno sobre la serie, y lo que hace se ve en la tabla.
    const direccion = page.url();
    await turnos
      .nth(0)
      .getByRole('button', { name: /Ver o mover el turno del/ })
      .click();
    const detalle = panelDeTurno(page, 'Turno');
    await detalle.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(detalle.locator('.estado-turno')).toContainText('Confirmado');
    await expect(turnos.nth(0)).toContainText('Confirmado');
    await detalle.getByRole('button', { name: 'Cerrar el panel' }).click();
    await cerrarAvisos(page);
    expect(page.url()).toBe(direccion);

    // Cancelar va en el menu "⋯" de la fila (cuatro acciones por turno).
    await abrirAcciones(turnos.nth(1));
    await turnos
      .nth(1)
      .getByRole('button', { name: /Cancelar este y los siguientes/ })
      .click();
    await expect(page.getByText('Se cancelarian estos 2 turnos:')).toBeVisible();
    await page.getByLabel('Motivo de la cancelacion').fill('El paciente termino el tratamiento');
    await page.getByRole('button', { name: 'Cancelar 2 turnos' }).click();
    // UX-12: el resultado es un aviso global, en la region de notificaciones.
    await expect(
      page.getByRole('region', { name: 'Notificaciones' }).getByText('Se cancelaron 2 turnos'),
    ).toBeVisible();

    await expect(turnos.nth(0)).toContainText('Confirmado');
    await expect(turnos.nth(1)).toContainText('Cancelado');
    await expect(turnos.nth(2)).toContainText('Cancelado');

    const guardada = await api.exigir<{ turnos: TurnoDeSerie[] }>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/series-de-turnos/${serieId}`,
    );
    expect(guardada.turnos.map((t) => t.estado)).toEqual(['CONFIRMADO', 'CANCELADO', 'CANCELADO']);

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
