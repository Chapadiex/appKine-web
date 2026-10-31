import { Locator, Page } from '@playwright/test';

import {
  expect,
  ingresar,
  navegar,
  panelDeTurno,
  problemaDe,
  respuestaDe,
} from './support/agenda-real';
import { ZONA_DEL_NAVEGADOR_DE_HOY, test } from './support/centro-de-hoy';
import { abrirAcciones } from './support/filtros';
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

/**
 * Entra como entra el mostrador: desde la agenda, por su unico enlace, que no lleva fecha. Y busca
 * al paciente, como el mostrador: la tabla pagina de a 10 (UX-14) y el centro de hoy junta los
 * turnos de todos los tests del dia, asi que la fila puede no estar en la primera pagina.
 */
async function abrirLaRecepcion(page: Page, persona: Persona): Promise<Locator> {
  await navegar(page, '/agenda');
  await page.getByRole('link', { name: 'Recepción', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recepción del día', level: 1 })).toBeVisible();
  await page.getByLabel('Paciente o documento').fill(persona.apellido);
  await expect(page.locator('.filtros-barra__resultados')).toHaveText('1 turno');
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

    // Desde la validacion observada la transicion siguiente (Validar) sigue a la vista y pasar a
    // espera va en el menu "⋯" de la fila.
    await abrirAcciones(fila);
    await fila.getByRole('button', { name: 'Pasar a espera' }).click();
    await expect(fila.getByText('EN_ESPERA', { exact: true })).toBeVisible();

    // En la sala de espera "Llamar" es la transicion siguiente: queda a la vista.
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

    await abrirAcciones(fila);
    await fila.getByRole('button', { name: 'Atender como Particular' }).click();
    const panel = page.getByRole('dialog');
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

    // UX-12: una accion de la fila, sin formulario: el rechazo es un aviso global con la salida.
    const aviso = page
      .getByRole('region', { name: 'Notificaciones' })
      .getByRole('alert')
      .filter({ hasText: 'No pudimos validar la recepción' });
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('Lo que dijo el servidor:');
    // La pantalla corrige la fila sola con lo que dice el servidor: sin recepcion abierta, vuelve
    // a ofrecer el check-in. Releer el dia entero lo confirma.
    await expect(fila.getByRole('button', { name: 'Registrar la llegada' })).toBeVisible();
    await aviso.getByRole('button', { name: 'Releer el día' }).click();
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
    await abrirAcciones(fila);
    await fila.getByRole('button', { name: 'Pasar a espera' }).click();
    await expect(fila.getByText('EN_ESPERA', { exact: true })).toBeVisible();
    await abrirAcciones(fila);
    await expect(fila.getByRole('button', { name: 'Atender como Particular' })).toBeVisible();

    await fila.getByRole('button', { name: 'Se retiro sin ser atendido' }).click();
    const panel = page.getByRole('dialog');
    await panel.getByRole('button', { name: 'Registrar el retiro' }).click();
    await expect(panel.getByText('Escribi por que se retiro: es obligatorio.')).toBeVisible();

    const retiro = respuestaDe(page, 'POST', /\/recepcion\/retiro$/);
    await panel.getByLabel('Motivo (obligatorio)').fill('Se canso de esperar');
    await panel.getByRole('button', { name: 'Registrar el retiro' }).click();
    expect((await retiro).status()).toBe(200);

    await expect(fila.getByText('RETIRADO', { exact: true })).toBeVisible();
    await expect(fila.getByText('Motivo del retiro: Se canso de esperar')).toBeVisible();
    // No queda ninguna transicion: solo se puede mirar el turno.
    const verElTurno = fila.getByRole('button', { name: `Ver el turno de ${persona.apellido}` });
    await expect(fila.getByRole('button')).toHaveCount(1);
    await expect(verElTurno).toBeVisible();

    const guardado = await verTurno(api, centro, turno.id);
    expect(guardado.recepcion?.estado).toBe('RETIRADO');
    expect(guardado.estado).toBe('RESERVADO');

    // Un check-in nuevo rebota: la llegada ya consta.
    const otraLlegada = await api.pedir(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/turnos/${turno.id}/recepcion`,
    );
    expect(otraLlegada.status()).toBe(409);

    // El panel del turno no ofrece la ausencia ni la reprogramacion, y muestra el RETIRO. Cancelar si:
    // el retiro no cierra la reserva, y el turno todavia no empezo.
    await verElTurno.click();
    const detalle = panelDeTurno(page, 'Turno');
    await expect(detalle.getByText('Se retiró sin ser atendido')).toBeVisible();
    await expect(detalle.getByText('Motivo del retiro: Se canso de esperar')).toBeVisible();
    await expect(detalle.getByRole('button', { name: 'Marcar ausente' })).toHaveCount(0);
    await expect(detalle.getByRole('button', { name: 'Reprogramar' })).toHaveCount(0);
    await detalle.getByText('Más acciones').click();
    await expect(detalle.getByRole('button', { name: 'Cancelar turno' })).toBeVisible();

    await detalle.getByRole('button', { name: 'Ver historial' }).click();
    const historial = panelDeTurno(page, 'Historial del turno').getByRole('region', {
      name: 'Historial de la recepción',
    });
    await expect(historial.getByText(/Se retiro sin ser atendido/).first()).toBeVisible();
    await expect(historial.getByText('Se canso de esperar')).toBeVisible();
  });

  /**
   * Lo que se hace en el panel se ve en la fila sin que nadie recargue, y quien estaba buscando sigue
   * buscando: abrir un turno no le cambia el lugar a la recepcion (TURNO - Tecnico §87 y §88).
   */
  test('confirmar desde el panel actualiza la fila y conserva la busqueda', async ({
    page,
    api,
    centro,
  }) => {
    const fila = await abrirLaRecepcion(page, persona);
    await expect(fila.getByText('RESERVADO', { exact: true })).toBeVisible();
    const direccion = page.url();

    await abrirAcciones(fila);
    await fila.getByRole('button', { name: `Ver el turno de ${persona.apellido}` }).click();
    const detalle = panelDeTurno(page, 'Turno');
    await detalle.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(detalle.locator('.estado-turno')).toContainText('Confirmado');
    await detalle.getByRole('button', { name: 'Cerrar el panel' }).click();

    await expect(fila.getByText('CONFIRMADO', { exact: true })).toBeVisible();
    expect(page.url()).toBe(direccion);
    await expect(page.getByLabel('Paciente o documento')).toHaveValue(persona.apellido);
    await expect(page.locator('.filtros-barra__resultados')).toHaveText('1 turno');
    expect((await verTurno(api, centro, turno.id)).estado).toBe('CONFIRMADO');
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
