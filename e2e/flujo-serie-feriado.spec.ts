import {
  abrirProgramacion,
  avisos,
  expect,
  ingresar,
  navegar,
  previsualizarSerie,
  respuestaDe,
  test,
} from './support/agenda-real';
import {
  ApiAkine,
  Centro,
  Oferta,
  Slot,
  agendaDe,
  crearOferta,
  crearPersona,
  fechaLocal,
  hora,
  sumarDias,
} from './support/sembrado';
import { diaIso } from './support/sembrado-configuracion';

/**
 * E2E de una serie con una ocurrencia en feriado (U-22, DP-43, y TURNO - Tecnico §20) contra el
 * backend REAL.
 *
 * <p>Un feriado no frena la serie. Por pantalla la fecha del feriado viene excluida en la propuesta y se
 * puede confirmar sin tocarla: se reserva lo que queda. Por la API, una regla sin ocurrencias elegidas
 * omite el feriado sola y lo informa en `ocurrenciasOmitidas`, que es lo que el detalle de la serie
 * muestra como "Fechas omitidas".
 *
 * <p>El feriado es uno nacional real del calendario de la sede, buscado hacia adelante: el centro
 * solo abre los de hoy y manana (`abrirLosFeriadosCercanos`), asi que uno de dentro de unas semanas
 * sigue cerrado. La serie arranca una semana antes y termina una despues: tres ocurrencias, la del
 * medio en feriado.
 */

interface SerieGuardada {
  readonly id: number;
  readonly turnos: readonly { readonly estado: string }[];
  readonly ocurrenciasOmitidas?: readonly { readonly fecha: string; readonly motivo: string }[];
}

/**
 * Un feriado cerrado de la sede con lugar a la misma hora una semana antes y una despues.
 *
 * <p>`desdeElFinal` elige el slot, contado desde el ultimo: lejos de los que eligen las otras series.
 */
async function serieConFeriado(
  api: ApiAkine,
  centro: Centro,
  oferta: Oferta,
  desdeElFinal: number,
): Promise<{ fecha: string; feriado: string; slot: Slot } | null> {
  const desde = fechaLocal(centro.timezone, 10);
  const calendario = await api.exigir<{ feriados: { fecha: string }[] }>(
    'GET',
    `/api/v1/consultorios/${centro.consultorioId}/calendario?desde=${desde}&hasta=${sumarDias(desde, 300)}`,
  );
  for (const { fecha: feriado } of calendario.feriados) {
    const [dia] = await agendaDe(api, centro, oferta.id, feriado);
    if (dia === undefined || dia.motivoSinSlots !== 'FERIADO') {
      continue;
    }
    const fecha = sumarDias(feriado, -7);
    const [antes] = await agendaDe(api, centro, oferta.id, fecha);
    const [despues] = await agendaDe(api, centro, oferta.id, sumarDias(feriado, 7));
    const slot = antes?.slots.at(desdeElFinal);
    if (slot === undefined) {
      continue;
    }
    const horaDelSlot = slot.desde.slice(11);
    if (despues?.slots.some((s) => s.desde.slice(11) === horaDelSlot)) {
      return { fecha, feriado, slot };
    }
  }
  return null;
}

test.describe('Serie con un feriado contra el backend real', () => {
  test('por pantalla el feriado viene excluido: sin tocarlo, se reserva el resto', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const persona = await crearPersona(api);
    const plan = await serieConFeriado(api, centro, oferta, -6);
    test.skip(plan === null, 'el calendario de la sede no tiene un feriado cerrado por delante');
    if (plan === null) {
      return;
    }
    await ingresar(page, centro);

    const panel = await abrirProgramacion(page, oferta, persona);
    await previsualizarSerie(panel, plan.fecha, hora(plan.slot.desde, centro.timezone), 3);

    const filas = panel.getByRole('table').locator('tbody tr');
    await expect(panel.getByRole('cell', { name: 'Disponible', exact: true })).toHaveCount(2);
    await expect(filas.nth(1)).toContainText('Feriado: se omite');
    // No queda nada por resolver: el feriado no frena el alta.
    await expect(panel.getByText(/sesiones sin horario/)).toHaveCount(0);

    const alta = respuestaDe(page, 'POST', /\/series-de-turnos$/);
    await panel.getByRole('button', { name: 'Confirmar 2 turnos' }).click();
    const respuesta = await alta;
    expect(respuesta.status(), await respuesta.text()).toBe(201);
    const creada = (await respuesta.json()) as SerieGuardada;
    await expect(avisos(page).getByText('2 turnos creados correctamente.')).toBeVisible();

    const guardada = await api.exigir<SerieGuardada>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/series-de-turnos/${creada.id}`,
    );
    expect(guardada.turnos).toHaveLength(2);
    expect(guardada.ocurrenciasOmitidas?.map((o) => o.fecha)).toEqual([plan.feriado]);
  });

  test('por la API el feriado se omite, y el detalle de la serie lo informa', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const persona = await crearPersona(api);
    const plan = await serieConFeriado(api, centro, oferta, -8);
    test.skip(plan === null, 'el calendario de la sede no tiene un feriado cerrado por delante');
    if (plan === null) {
      return;
    }

    const creada = await api.exigir<SerieGuardada>(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/series-de-turnos`,
      {
        ofertaId: oferta.id,
        personaId: persona.id,
        profesionalId: plan.slot.profesionalId,
        diasSemana: [diaIso(plan.fecha)],
        fechaDesde: plan.fecha,
        hora: hora(plan.slot.desde, centro.timezone),
        cantidad: 3,
      },
    );
    expect(creada.turnos).toHaveLength(2);
    expect(creada.ocurrenciasOmitidas).toEqual([
      expect.objectContaining({ fecha: plan.feriado, motivo: 'FERIADO' }),
    ]);

    await ingresar(page, centro);
    await navegar(page, `/agenda/series/${creada.id}`);
    await expect(page.getByRole('heading', { name: 'Fechas omitidas al reservar' })).toBeVisible();
    await expect(page.getByText(/Feriado: la sede no atiende/)).toBeVisible();
  });
});
