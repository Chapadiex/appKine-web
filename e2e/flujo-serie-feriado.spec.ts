import { expect, abrirReserva, ingresar, navegar, test } from './support/agenda-real';
import {
  ApiAkine,
  Centro,
  Oferta,
  Slot,
  agendaDe,
  crearOferta,
  crearPersona,
  fechaLocal,
  sumarDias,
} from './support/sembrado';

/**
 * E2E de U-22 (DP-43) contra el backend REAL: una serie con una ocurrencia en feriado ya no falla
 * entera. La previsualizacion dice "Se omitira", el alta reserva las demas y devuelve la omitida en
 * `ocurrenciasOmitidas`, que tambien se ve en el detalle de la serie.
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

/** Un feriado cerrado de la sede con lugar a la misma hora una semana antes y una despues. */
async function serieConFeriado(
  api: ApiAkine,
  centro: Centro,
  oferta: Oferta,
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
    // Un slot del medio de la tarde: lejos del ultimo, que es el que eligen las otras series.
    const slot = antes?.slots.at(-6);
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
  test('el feriado se omite: la previsualizacion lo dice, el alta reserva el resto y lo informa', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const persona = await crearPersona(api);
    const plan = await serieConFeriado(api, centro, oferta);
    test.skip(plan === null, 'el calendario de la sede no tiene un feriado cerrado por delante');
    if (plan === null) {
      return;
    }
    await ingresar(page, centro);

    await abrirReserva(page, oferta, plan.fecha, plan.slot, persona);
    await page.getByRole('link', { name: 'Reservar una serie semanal desde este horario' }).click();
    await expect(
      page.getByRole('heading', { name: 'Reservar una serie de turnos', level: 1 }),
    ).toBeVisible();
    await page.getByLabel('Documento, apellido, nombre o telefono').fill(persona.apellido);
    await page.getByRole('button', { name: `${persona.apellido}, ${persona.nombre}` }).click();
    const cantidad = page.getByLabel(/Cantidad de turnos/);
    await cantidad.fill('3');
    await cantidad.blur();

    await page.getByRole('button', { name: 'Previsualizar los turnos' }).click();
    const prevista = page.getByRole('region', { name: 'Turnos de la serie' });
    await expect(prevista.getByText('Libre', { exact: true })).toHaveCount(2);
    await expect(prevista.getByText('Se omitira', { exact: true })).toHaveCount(1);
    await expect(page.getByText('1 fecha(s) caen en feriado')).toBeVisible();

    const alta = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && /\/series-de-turnos$/.test(new URL(r.url()).pathname),
    );
    await page.getByRole('button', { name: 'Reservar los 2 turnos' }).click();
    const respuesta = await alta;
    expect(respuesta.status(), await respuesta.text()).toBe(201);
    const creada = (await respuesta.json()) as SerieGuardada;

    await expect(page.getByRole('heading', { name: 'Serie reservada' })).toBeVisible();
    await expect(page.getByText('Se reservaron 2 turnos.')).toBeVisible();
    await expect(page.getByText('No se reservaron 1 fecha(s)')).toBeVisible();

    const guardada = await api.exigir<SerieGuardada>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/series-de-turnos/${creada.id}`,
    );
    expect(guardada.turnos).toHaveLength(2);
    expect(guardada.ocurrenciasOmitidas).toEqual([
      expect.objectContaining({ fecha: plan.feriado, motivo: 'FERIADO' }),
    ]);

    await navegar(page, `/agenda/series/${creada.id}`);
    await expect(page.getByRole('heading', { name: 'Fechas omitidas al reservar' })).toBeVisible();
    await expect(page.getByText(/Feriado: la sede no atiende/)).toBeVisible();
  });
});
