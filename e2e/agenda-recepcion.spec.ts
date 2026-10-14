import { Locator, Page } from '@playwright/test';

import { expect, ingresar, navegar, problemaDe, respuestaDe, test } from './support/agenda-real';
import {
  Oferta,
  Persona,
  Turno,
  crearOferta,
  crearPersona,
  fechaLocal,
  turnoDeHoy,
  uriDeProblema,
  verTurno,
} from './support/sembrado';

/**
 * E2E de la recepcion del dia (M13, AKINE E-4 / DP-16) contra el backend REAL (AKINE E-2):
 * registrar la llegada → validar o seguir como Particular → pasar a espera → llamar.
 *
 * <p>La recepcion solo opera turnos de HOY, asi que estos tests reservan por la API el primer
 * horario todavia futuro del dia. Pasadas las 23:30 en la zona de la sede ya no queda ninguno y
 * los tests se saltean diciendo por que: no hay forma honesta de tener un turno de hoy a esa hora.
 *
 * <p>La oferta va SIN habilitaciones explicitas (la presta cualquier profesional de la sede): una
 * habilitacion cargada hoy no vale para hoy, porque el motor la evalua al mediodia local.
 *
 * <p>Despues de cada paso se relee el turno por la API. Que la fila diga `LLAMADA` no prueba que
 * la recepcion haya quedado asi guardada, y DP-16 exige ademas que el TURNO no cambie de estado.
 */

/** La fila del turno en la tabla del dia, ubicada por el apellido unico de la persona. */
function filaDe(page: Page, persona: Persona): Locator {
  return page.getByRole('row').filter({ hasText: persona.apellido });
}

/** Entra como entra el mostrador: desde la agenda, por su unico enlace, que no lleva fecha. */
async function abrirLaRecepcion(page: Page, persona: Persona): Promise<Locator> {
  await navegar(page, '/agenda');
  await page.getByRole('link', { name: 'Ver la recepcion del dia' }).click();
  await expect(page.getByRole('heading', { name: 'Recepcion del dia', level: 1 })).toBeVisible();
  const fila = filaDe(page, persona);
  await expect(fila).toBeVisible();
  return fila;
}

test.describe('Recepcion del dia contra el backend real', () => {
  let oferta: Oferta;
  let persona: Persona;
  let turno: Turno;

  test.beforeEach(async ({ page, api, centro }) => {
    // Turnos de 15 minutos: quedan muchos horarios futuros hoy aunque la suite corra de noche.
    oferta = await crearOferta(api, centro, { habilitarProfesional: false, duracionMinutos: 15 });
    persona = await crearPersona(api);
    const reservado = await turnoDeHoy(api, centro, oferta, persona);
    test.skip(
      reservado === null,
      `no queda ningun horario futuro hoy (${fechaLocal(centro.timezone)}) en ${centro.timezone}`,
    );
    turno = reservado!;
    await ingresar(page, centro);
  });

  test('llegada, validacion observada, espera y llamado: la recepcion avanza y el turno no', async ({
    page,
    api,
    centro,
  }) => {
    const fila = await abrirLaRecepcion(page, persona);
    await expect(fila.getByText('Sin recepcion')).toBeVisible();

    await fila.getByRole('button', { name: 'Registrar la llegada' }).click();
    await expect(fila.getByText('LLEGO', { exact: true })).toBeVisible();
    await expect(fila.getByText('Todavia no llego')).toHaveCount(0);

    // La oferta no declara practica: el servidor deja la recepcion OBSERVADA, que avisa y no
    // bloquea (RN-M13-003). La decision es del servidor; la pantalla no manda el resultado.
    await fila.getByRole('button', { name: 'Validar cobertura' }).click();
    await expect(fila.getByText('OBSERVADA', { exact: true })).toBeVisible();
    await expect(fila.getByText(/Observacion: OFERTA_SIN_PRACTICA/)).toBeVisible();

    await fila.getByRole('button', { name: 'Pasar a espera' }).click();
    await expect(fila.getByText('EN_ESPERA', { exact: true })).toBeVisible();

    await fila.getByRole('button', { name: 'Llamar' }).click();
    await expect(fila.getByText('LLAMADA', { exact: true })).toBeVisible();
    await expect(fila.getByRole('button', { name: 'Llamar' })).toHaveCount(0);

    const guardado = await verTurno(api, centro, turno.id);
    expect(guardado.recepcion?.estado).toBe('LLAMADA');
    // DP-16: la recepcion tiene maquina propia. El turno sigue siendo solo la reserva.
    expect(guardado.estado).toBe('RESERVADO');
  });

  test('seguir como Particular exige motivo y deja la recepcion lista para la espera', async ({
    page,
    api,
    centro,
  }) => {
    const fila = await abrirLaRecepcion(page, persona);
    await fila.getByRole('button', { name: 'Registrar la llegada' }).click();
    await expect(fila.getByText('LLEGO', { exact: true })).toBeVisible();

    await fila.getByRole('button', { name: 'Atender como Particular' }).click();
    const panel = page.getByRole('region', { name: 'Confirmar la transicion de la recepcion' });
    await panel.getByLabel('Motivo (obligatorio)').fill('No trajo la credencial de la obra social');
    await panel.getByRole('button', { name: 'Atender como Particular' }).click();

    await expect(fila.getByRole('button', { name: 'Pasar a espera' })).toBeVisible();
    await fila.getByRole('button', { name: 'Pasar a espera' }).click();
    await expect(fila.getByText('EN_ESPERA', { exact: true })).toBeVisible();

    const guardado = await verTurno(api, centro, turno.id);
    expect(guardado.recepcion?.estado).toBe('EN_ESPERA');
    expect(guardado.recepcion?.modalidad).toBe('PARTICULAR');
  });

  /**
   * Otra persona anula la llegada mientras esta pantalla la muestra. Validar sobre una recepcion
   * que ya no existe tiene que rebotar con el 409 REAL del servidor, explicar el motivo que dio el
   * servidor y dejar la fila en "Sin recepcion", lista para registrar la llegada de nuevo.
   */
  test('validar una llegada que otra persona anulo rebota con 409 y releer el dia lo resuelve', async ({
    page,
    api,
    centro,
  }) => {
    const fila = await abrirLaRecepcion(page, persona);
    await fila.getByRole('button', { name: 'Registrar la llegada' }).click();
    await expect(fila.getByText('LLEGO', { exact: true })).toBeVisible();

    const leido = await api.exigir<{ recepcion: { version: number } }>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/turnos/${turno.id}`,
    );
    await api.exigir(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/turnos/${turno.id}/recepcion/anulacion`,
      {
        expectedVersion: leido.recepcion.version,
        motivo: 'Check-in cargado al paciente equivocado',
      },
    );

    const rechazo = respuestaDe(page, 'POST', /\/recepcion\/validacion$/);
    await fila.getByRole('button', { name: 'Validar cobertura' }).click();
    const respuesta = await rechazo;
    expect(respuesta.status()).toBe(409);
    const problema = await problemaDe(respuesta);
    expect(problema.type).toBe(uriDeProblema('recepcion-transicion-no-permitida'));

    await expect(
      page.getByRole('heading', { name: 'No se pudo completar la operacion' }),
    ).toBeVisible();
    await expect(page.getByText('Lo que dijo el servidor:')).toBeVisible();
    // La pantalla corrige la fila sola con lo que dice el servidor: sin recepcion abierta, vuelve
    // a ofrecer el check-in. Releer el dia entero lo confirma.
    await expect(fila.getByRole('button', { name: 'Registrar la llegada' })).toBeVisible();
    await page.getByRole('button', { name: 'Volver a leer el dia' }).click();
    await expect(fila.getByText('Sin recepcion')).toBeVisible();
    await expect(fila.getByRole('button', { name: 'Registrar la llegada' })).toBeVisible();
  });

  test('un turno cancelado se lista con su motivo y no admite registrar la llegada', async ({
    page,
    api,
    centro,
  }) => {
    await api.exigir(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/turnos/${turno.id}/cancelacion`,
      { motivo: 'Cancelo por telefono a la mañana', expectedVersion: turno.version },
    );

    const fila = await abrirLaRecepcion(page, persona);
    await expect(fila.getByText('CANCELADO', { exact: true })).toBeVisible();
    await expect(fila.getByText('Motivo: Cancelo por telefono a la mañana')).toBeVisible();
    await expect(fila.getByRole('button', { name: 'Registrar la llegada' })).toHaveCount(0);
  });
});
