import {
  abrirLaDisponibilidad,
  expect,
  ingresar,
  navegar,
  respuestaDe,
  test,
} from './support/agenda-real';
import { cerrarAvisos } from './support/avisos';
import { agendaDe, crearPersona, rango, reservar, sumarDias } from './support/sembrado';
import {
  diaIso,
  feriadoConSemanasHabiles,
  ofertaDe,
  vincularProfesional,
} from './support/sembrado-configuracion';

/**
 * E2E de horarios y disponibilidad (M05, AKINE-02.04 y A-11) contra el backend REAL: bloque
 * semanal de una profesional, cierre con su impacto previo, feriado del calendario de la sede, y
 * que la agenda refleje las tres cosas.
 *
 * <p><b>No se toca al profesional compartido del centro</b>, que atiende las 24 horas y lo usan
 * todos los specs de agenda: un bloque o un cierre sobre el le cambiaria la agenda a los demas. Se
 * vincula una profesional propia, sin horario, y la oferta del test la habilita solo a ella. Los
 * feriados son del calendario nacional: se leen, no se cargan.
 *
 * <p>Los tres dias son el mismo dia de la semana —F, el feriado; F+7, habil; F+14, el cierre—, asi
 * que un solo bloque semanal alcanza. F se busca dentro de los proximos 60 dias porque el impacto
 * previo de una excepcion mira como mucho 90 dias hacia adelante.
 */
/** Nombre de cada dia ISO tal como lo rotulan las pastillas del formulario. */
const NOMBRE_DE_DIA: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miercoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sabado',
  7: 'Domingo',
};

test.describe('Horarios y disponibilidad contra el backend real', () => {
  test('bloque semanal, cierre con impacto y feriado, reflejados en la agenda', async ({
    page,
    api,
    centro,
  }) => {
    const feriado = await feriadoConSemanasHabiles(api, centro, 3, 60);
    test.skip(
      feriado === null,
      'la sede no cierra por feriado o el calendario no trae un feriado con dos semanas habiles despues',
    );
    const f = feriado!.fecha;
    const habil = sumarDias(f, 7);
    const cerrado = sumarDias(f, 14);

    const profesional = await vincularProfesional(api, centro);
    const oferta = await ofertaDe(api, centro, profesional, { duracionMinutos: 60 });
    await ingresar(page, centro);

    // --- Bloque semanal por pantalla ---
    await navegar(page, '/horarios');
    await page.getByLabel('Elegí un profesional').selectOption({ label: profesional.nombre });
    await expect(
      page.getByRole('heading', { name: `Semana de ${profesional.nombre}`, level: 2 }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Agregar horario' }).click();
    // Carga rapida (05/11/2026): un solo dia, elegido a mano entre los siete.
    await page.getByRole('radio', { name: 'Personalizado' }).check();
    for (const dia of [1, 2, 3, 4, 5]) {
      if (dia !== diaIso(f)) {
        await page.getByRole('checkbox', { name: NOMBRE_DE_DIA[dia] }).uncheck();
      }
    }
    await page.getByRole('checkbox', { name: NOMBRE_DE_DIA[diaIso(f)] }).check();
    await page.getByLabel('Desde', { exact: true }).selectOption('09:00');
    await page.getByLabel('Hasta', { exact: true }).selectOption('12:00');
    const bloque = respuestaDe(page, 'POST', /\/profesionales\/\d+\/disponibilidad\/lote$/);
    await page.getByRole('button', { name: 'Guardar horario' }).click();
    expect((await bloque).status()).toBe(201);
    // UX-12: el resultado va al aviso global, no al cuerpo de la pantalla.
    const avisos = page.getByRole('region', { name: 'Notificaciones', exact: true });
    await expect(avisos.getByText('Horario agregado')).toBeVisible();
    await expect(page.locator('.bloque__horario', { hasText: '09:00 a 12:00' })).toBeVisible();

    // El bloque ya produce turnos el dia habil y el que despues se cierra; el feriado no.
    const antes = await agendaDe(api, centro, oferta.id, f, sumarDias(cerrado, 1));
    const dia = (fecha: string) => antes.find((d) => d.fecha === fecha)!;
    expect(dia(habil).slots).toHaveLength(3);
    expect(dia(cerrado).slots).toHaveLength(3);
    expect(dia(f).motivoSinSlots).toBe('FERIADO');

    // Un turno en el dia que se va a cerrar: el impacto previo tiene que contarlo.
    const persona = await crearPersona(api);
    await reservar(
      api,
      { ...centro, profesional },
      oferta.id,
      persona.id,
      dia(cerrado).slots[0].desde,
    );

    // --- Cierre de la profesional por pantalla, con su impacto ---
    await navegar(page, '/horarios/excepciones');
    await page.getByRole('button', { name: 'Cargar un cierre o una apertura' }).click();
    await page.getByLabel('Que se carga').selectOption('CIERRE');
    await page.getByLabel('A quien alcanza').selectOption({ label: profesional.nombre });
    await page.getByLabel('Primer día').fill(cerrado);
    await page.getByLabel('Fin (exclusivo)').fill(sumarDias(cerrado, 1));
    await expect(page.getByLabel('Día completo')).toBeChecked();

    const impacto = respuestaDe(page, 'POST', /\/excepciones\/impacto-de-alta$/);
    await page.getByRole('button', { name: 'Cargar la excepción' }).click();
    expect((await impacto).status()).toBe(200);
    await expect(page.getByText('Turnos afectados: 1.')).toBeVisible();

    const alta = respuestaDe(page, 'POST', /\/excepciones$/);
    await page.getByRole('button', { name: 'Cargar igual' }).click();
    expect([200, 201]).toContain((await alta).status());
    await expect(avisos.getByText('Cierre cargado')).toBeVisible();
    // Dejo un turno afuera: el aviso de atencion queda hasta que lo cierren.
    await expect(avisos.getByText('Turnos para revisar')).toBeVisible();
    await cerrarAvisos(page);

    // --- El feriado en el calendario de la sede ---
    await navegar(page, '/horarios/calendario');
    await page.getByLabel('Desde').fill(f);
    await page.getByLabel('Hasta (exclusivo)').fill(sumarDias(f, 1));
    await page.getByRole('button', { name: 'Consultar' }).click();
    await expect(page.getByRole('row').filter({ hasText: feriado!.nombre })).toBeVisible();
    await expect(page.getByLabel('La sede cierra los feriados de su calendario')).toBeChecked();

    // --- La agenda lo refleja ---
    const despues = await agendaDe(api, centro, oferta.id, f, sumarDias(cerrado, 1));
    expect(despues.find((d) => d.fecha === cerrado)!.motivoSinSlots).toBe('CIERRE');
    expect(despues.find((d) => d.fecha === habil)!.slots).toHaveLength(3);

    await abrirLaDisponibilidad(page, oferta, f, sumarDias(cerrado, 1));
    await expect(page.getByText('Feriado: la sede no atiende este día.')).toBeVisible();
    await expect(
      page.getByText('La sede cierra este día por una excepción cargada en el calendario.'),
    ).toBeVisible();
    // Las tres franjas del dia habil, y ninguna mas en toda la ventana.
    for (const slot of dia(habil).slots) {
      await expect(page.getByRole('button', { name: rango(slot, centro.timezone) })).toHaveCount(1);
    }
  });
});
