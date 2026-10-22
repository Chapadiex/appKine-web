import { Locator, Page } from '@playwright/test';

import { expect, ingresar, navegar, problemaDe, respuestaDe } from './support/agenda-real';
import { ZONA_DEL_NAVEGADOR_DE_HOY, test } from './support/centro-de-hoy';
import {
  Oferta,
  Persona,
  Turno,
  crearOferta,
  crearPersona,
  turnoDeHoy,
  uriDeProblema,
  verTurno,
} from './support/sembrado';

/**
 * E2E de la recepcion del dia (M13, AKINE E-4 / DP-16) contra el backend REAL (AKINE E-2):
 * registrar la llegada → validar o seguir como Particular → pasar a espera → llamar.
 *
 * <p>La recepcion solo opera turnos de HOY, asi que estos tests reservan por la API el primer
 * horario todavia futuro del dia, en un centro cuya sede esta en una zona donde ahora es media
 * mañana (`support/centro-de-hoy.ts`). Sobre el centro compartido, con la sede en Cordoba, fallaban
 * cada vez que el CI corria cerca de la medianoche de alli (`motivo: PASADO`).
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
  await page.getByRole('link', { name: 'Recepción', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recepción del día', level: 1 })).toBeVisible();
  const fila = filaDe(page, persona);
  await expect(fila).toBeVisible();
  return fila;
}

test.use({ timezoneId: ZONA_DEL_NAVEGADOR_DE_HOY });

test.describe('Recepcion del dia contra el backend real', () => {
  let oferta: Oferta;
  let persona: Persona;
  let turno: Turno;

  test.beforeEach(async ({ page, api, centro }) => {
    oferta = await crearOferta(api, centro, { habilitarProfesional: false, duracionMinutos: 15 });
    persona = await crearPersona(api);
    turno = await turnoDeHoy(api, centro, oferta, persona);
    await ingresar(page, centro);
  });

  test('llegada, validacion observada, espera y llamado: la recepcion avanza y el turno no', async ({
    page,
    api,
    centro,
  }) => {
    const fila = await abrirLaRecepcion(page, persona);
    await expect(fila.getByText('Sin recepción')).toBeVisible();

    await fila.getByRole('button', { name: 'Registrar la llegada' }).click();
    await expect(fila.getByText('LLEGO', { exact: true })).toBeVisible();
    await expect(fila.getByText('Todavía no llego')).toHaveCount(0);

    // La oferta no declara practica: el servidor deja la recepcion OBSERVADA, que avisa y no
    // bloquea (RN-M13-003). La decision es del servidor; la pantalla no manda el resultado.
    await fila.getByRole('button', { name: 'Validar cobertura' }).click();
    await expect(fila.getByText('OBSERVADA', { exact: true })).toBeVisible();
    await expect(fila.getByText(/Observaci[oó]n: OFERTA_SIN_PRACTICA/)).toBeVisible();

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
    const panel = page.getByRole('region', { name: 'Confirmar la transicion de la recepción' });
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
      page.getByRole('heading', { name: 'No se pudo completar la operación' }),
    ).toBeVisible();
    await expect(page.getByText('Lo que dijo el servidor:')).toBeVisible();
    // La pantalla corrige la fila sola con lo que dice el servidor: sin recepcion abierta, vuelve
    // a ofrecer el check-in. Releer el dia entero lo confirma.
    await expect(fila.getByRole('button', { name: 'Registrar la llegada' })).toBeVisible();
    await page.getByRole('button', { name: 'Volver a leer el día' }).click();
    await expect(fila.getByText('Sin recepción')).toBeVisible();
    await expect(fila.getByRole('button', { name: 'Registrar la llegada' })).toBeVisible();
  });

  /**
   * U-21 (DP-43): la persona se retira desde la sala. La llegada VALE: la recepcion queda RETIRADO,
   * el turno no cambia y ya no se ofrece otro check-in, ni marcar ausente ni moverlo. El backend lo
   * confirma con 409 a un check-in nuevo.
   */
  test('se retiro sin ser atendido: exige motivo, queda RETIRADO y el turno no admite ausencia', async ({
    page,
    api,
    centro,
  }) => {
    const fila = await abrirLaRecepcion(page, persona);
    await fila.getByRole('button', { name: 'Registrar la llegada' }).click();
    await expect(fila.getByText('LLEGO', { exact: true })).toBeVisible();
    // Particular desde la sala (U-21): llega a EN_ESPERA y se ofrece sin anular la llegada.
    await fila.getByRole('button', { name: 'Validar cobertura' }).click();
    await fila.getByRole('button', { name: 'Pasar a espera' }).click();
    await expect(fila.getByText('EN_ESPERA', { exact: true })).toBeVisible();
    await expect(fila.getByRole('button', { name: 'Atender como Particular' })).toBeVisible();

    await fila.getByRole('button', { name: 'Se retiro sin ser atendido' }).click();
    const panel = page.getByRole('region', { name: 'Confirmar la transicion de la recepción' });
    await panel.getByRole('button', { name: 'Registrar el retiro' }).click();
    await expect(panel.getByText('Escribi por que se retiro: es obligatorio.')).toBeVisible();

    const retiro = respuestaDe(page, 'POST', /\/recepcion\/retiro$/);
    await panel.getByLabel('Motivo (obligatorio)').fill('Se canso de esperar');
    await panel.getByRole('button', { name: 'Registrar el retiro' }).click();
    expect((await retiro).status()).toBe(200);

    await expect(fila.getByText('RETIRADO', { exact: true })).toBeVisible();
    await expect(fila.getByText('Motivo del retiro: Se canso de esperar')).toBeVisible();
    await expect(fila.getByRole('button')).toHaveCount(0);

    const guardado = await verTurno(api, centro, turno.id);
    expect(guardado.recepcion?.estado).toBe('RETIRADO');
    expect(guardado.estado).toBe('RESERVADO');

    // Un check-in nuevo rebota: la llegada ya consta.
    const otraLlegada = await api.pedir(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/turnos/${turno.id}/recepcion`,
    );
    expect(otraLlegada.status()).toBe(409);

    // El ciclo del turno no ofrece la ausencia ni la reprogramacion, y muestra el RETIRO.
    await fila.getByRole('link', { name: 'Ver el turno' }).click();
    await expect(page.getByText('se retiro sin ser atendida')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Marcar que no vino' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mover a otro horario' })).toHaveCount(0);
    const historial = page.getByRole('region', { name: 'Historial de la recepción' });
    await expect(historial.getByText('Se retiro sin ser atendido', { exact: true })).toBeVisible();
    await expect(historial.getByText('Se canso de esperar')).toBeVisible();
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
