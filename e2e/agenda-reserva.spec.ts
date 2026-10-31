import { Locator } from '@playwright/test';

import {
  RESERVA,
  VALIDACION,
  abrirLaDisponibilidad,
  abrirReserva,
  avisos,
  elegirPersona,
  expect,
  ingresar,
  panelDeTurno,
  problemaDe,
  respuestaDe,
  test,
} from './support/agenda-real';
import {
  DIAS,
  crearOferta,
  crearPersona,
  diaDeTrabajo,
  hora,
  rango,
  reservar,
  sumarDias,
  uriDeProblema,
  verTurno,
} from './support/sembrado';

/**
 * E2E de la reserva de turno (M12, AKINE-05.02) contra el backend REAL (AKINE E-2), sobre el panel
 * unico del flujo de turnos.
 *
 * <p>Los cuatro conflictos de la reserva se montan de verdad, con los endpoints del producto:
 *
 * <ul>
 *   <li>`slot-completo`: otra persona toma el horario por la API entre la lectura y la escritura.</li>
 *   <li>`slot-no-disponible`: se carga un cierre del profesional despues de abrir la reserva.</li>
 *   <li>`recurso-ocupado`: el mismo profesional ya tiene turno a esa hora en OTRA oferta.</li>
 *   <li>`persona-sin-perfil-paciente`: una persona del padron sin perfil de paciente.</li>
 * </ul>
 *
 * <p>Cada test afirma tres cosas: el `type` que emitio el servidor, la salida que ofrece el panel, y
 * que no ofrece las de otro conflicto. La tercera es la que impide que las ramas se colapsen en un
 * "no se pudo" generico.
 *
 * <p>Queda fuera `idempotency-key-conflict`: el panel genera la clave y no hay forma honesta de
 * hacerle mandar la misma con otro contenido.
 */

const TITULO_DE_CONFLICTO = 'Este horario acaba de ser reservado';

const confirmar = (panel: Locator): Locator =>
  panel.getByRole('button', { name: 'Confirmar turno' });

/** Las salidas de un conflicto de lugar: nada de lo que corresponde a una persona sin perfil. */
async function ofreceSalidasDeConflicto(panel: Locator): Promise<void> {
  await expect(panel.getByRole('button', { name: 'Agregar a lista de espera' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Activar como paciente' })).toHaveCount(0);
  // El horario ya no se puede reservar: el boton lo dice en vez de quedar mudo.
  await expect(confirmar(panel)).toBeDisabled();
  await expect(panel.getByText('Ese horario no se puede reservar.', { exact: true })).toBeVisible();
}

test.describe('Reserva de turno contra el backend real', () => {
  test.beforeEach(async ({ page, centro }) => {
    await ingresar(page, centro);
  });

  /**
   * El camino feliz completo, desde la busqueda de disponibilidad: si la grilla dejara de pasarle al
   * panel el horario o el profesional, este se cae. Al final se relee el turno por la API: un aviso
   * verde no prueba que el turno haya quedado guardado como se ve.
   */
  test('buscar, elegir un slot, elegir la persona, reservar y confirmar', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const persona = await crearPersona(api);
    const {
      fecha: d,
      slots: [slot],
    } = await diaDeTrabajo(api, centro, oferta.id, DIAS.reservaFeliz);

    await abrirLaDisponibilidad(page, oferta, d, sumarDias(d, 1));
    await expect(page.getByText(centro.timezone, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: rango(slot, centro.timezone) }).click();

    const panel = panelDeTurno(page);
    await elegirPersona(panel, persona);
    // Lo que se va a reservar: fecha, hora y profesional ya vienen de la celda.
    const resumen = panel.locator('.flujo__resumen');
    await expect(resumen).toContainText(rango(slot, centro.timezone));
    await expect(resumen).toContainText(centro.profesional.nombre);

    const creado = respuestaDe(page, 'POST', RESERVA);
    await confirmar(panel).click();
    const respuesta = await creado;
    expect(respuesta.status(), await respuesta.text()).toBe(201);
    const { id: turnoId } = (await respuesta.json()) as { id: number };
    await expect(avisos(page).getByText('Turno creado correctamente.')).toBeVisible();
    await expect(panel).toBeHidden();

    // "Ver turno", en el aviso, abre el detalle del turno recien creado.
    await avisos(page).getByRole('button', { name: 'Ver turno' }).click();
    const detalle = panelDeTurno(page, 'Turno');
    await expect(detalle.locator('.estado-turno')).toContainText('Reservado');
    await detalle.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(avisos(page).getByText('Turno confirmado.')).toBeVisible();
    await expect(detalle.locator('.estado-turno')).toContainText('Confirmado');

    const guardado = await verTurno(api, centro, turnoId);
    expect(guardado.estado).toBe('CONFIRMADO');
    expect(guardado.inicio).toBe(slot.desde);
    expect(guardado.personaId).toBe(persona.id);
  });

  test('slot-completo ofrece el turno siguiente, y tomarlo reserva ese horario', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const {
      fecha: d,
      slots: [primero, segundo],
    } = await diaDeTrabajo(api, centro, oferta.id, DIAS.reservaCompleto);
    const persona = await crearPersona(api);

    const panel = await abrirReserva(page, centro, oferta, d, primero, persona);
    // Otra recepcionista se lo gana entre la lectura y la escritura.
    await reservar(api, centro, oferta.id, (await crearPersona(api)).id, primero.desde);

    const rechazo = respuestaDe(page, 'POST', RESERVA);
    await confirmar(panel).click();
    const respuesta = await rechazo;
    expect(respuesta.status()).toBe(409);
    const problema = await problemaDe(respuesta);
    expect(problema.type).toBe(uriDeProblema('slot-completo'));
    expect(problema['cupoTotal']).toBe(1);

    await expect(panel.getByText(TITULO_DE_CONFLICTO)).toBeVisible();
    await expect(panel.getByText('Ese horario se lleno mientras lo mirabas.')).toBeVisible();
    await ofreceSalidasDeConflicto(panel);

    // Alternativas reales, y la siguiente es la que sigue en la agenda.
    await expect(panel.getByText('Opciones disponibles')).toBeVisible();
    await panel
      .locator('.horario')
      .filter({ hasText: hora(segundo.desde, centro.timezone) })
      .click();
    // UX-12: el conflicto es una alerta arriba del formulario; resuelto, desaparece.
    await expect(panel.getByText(TITULO_DE_CONFLICTO)).toHaveCount(0);
    await expect(panel.locator('.flujo__resumen')).toContainText(rango(segundo, centro.timezone));

    const creado = respuestaDe(page, 'POST', RESERVA);
    await confirmar(panel).click();
    const turno = (await (await creado).json()) as { id: number };
    await expect(avisos(page).getByText('Turno creado correctamente.')).toBeVisible();
    expect((await verTurno(api, centro, turno.id)).inicio).toBe(segundo.desde);
  });

  test('slot-no-disponible muestra lo que cambio y no deja confirmar ese horario', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const {
      fecha: d,
      slots: [slot],
    } = await diaDeTrabajo(api, centro, oferta.id, DIAS.reservaNoDisponible);
    const persona = await crearPersona(api);

    const panel = await abrirReserva(page, centro, oferta, d, slot, persona);
    // El profesional pide el dia despues de que la recepcion abrio la reserva.
    await api.exigir('POST', `/api/v1/consultorios/${centro.consultorioId}/excepciones`, {
      tipo: 'CIERRE',
      motivo: 'AUSENCIA',
      membershipId: centro.profesional.membershipId,
      fechaDesde: d,
      fechaHasta: sumarDias(d, 1),
    });

    const rechazo = respuestaDe(page, 'POST', RESERVA);
    const revalidacion = respuestaDe(page, 'POST', VALIDACION);
    await confirmar(panel).click();
    const respuesta = await rechazo;
    expect(respuesta.status()).toBe(409);
    const problema = await problemaDe(respuesta);
    expect(problema.type).toBe(uriDeProblema('slot-no-disponible'));
    expect(typeof problema['motivo']).toBe('string');

    await expect(panel.getByText('Ese horario dejo de estar disponible')).toBeVisible();
    // Lo que cambio lo dice el motor, en la relectura que el panel hace despues del rechazo.
    const validacion = (await (await revalidacion).json()) as { estado: string; motivo: string };
    expect(validacion.estado).toBe('NO_DISPONIBLE');
    await expect(panel.getByText(validacion.motivo, { exact: true })).toBeVisible();
    await ofreceSalidasDeConflicto(panel);

    const delDia = await api.exigir<{ turnos: { personaId: number }[] }>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/turnos?fecha=${d}`,
    );
    expect(delDia.turnos.filter((t) => t.personaId === persona.id)).toHaveLength(0);
  });

  test('recurso-ocupado dice con que se cruza y ofrece otras salidas', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const otraOferta = await crearOferta(api, centro);
    const {
      fecha: d,
      slots: [slot],
    } = await diaDeTrabajo(api, centro, oferta.id, DIAS.reservaRecursoOcupado);

    const panel = await abrirReserva(page, centro, oferta, d, slot, await crearPersona(api));
    // El mismo profesional, a la misma hora, en otra oferta.
    await reservar(api, centro, otraOferta.id, (await crearPersona(api)).id, slot.desde);

    const rechazo = respuestaDe(page, 'POST', RESERVA);
    await confirmar(panel).click();
    const respuesta = await rechazo;
    expect(respuesta.status()).toBe(409);
    const problema = await problemaDe(respuesta);
    expect(problema.type).toBe(uriDeProblema('recurso-ocupado'));
    expect(problema['recurso']).toBe('profesional');

    await expect(
      panel.getByText('Ya hay otro turno que se cruza con este intervalo.'),
    ).toBeVisible();
    await expect(panel.getByText(/Se cruza con un turno de /)).toBeVisible();
    await ofreceSalidasDeConflicto(panel);
    await expect(panel.getByRole('button', { name: 'Crear sobreturno' })).toBeVisible();
  });

  test('persona-sin-perfil-paciente se resuelve activando el perfil sin salir del panel', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const {
      fecha: d,
      slots: [slot],
    } = await diaDeTrabajo(api, centro, oferta.id, DIAS.reservaSinPerfil);
    const sinPerfil = await crearPersona(api, { conPerfil: false });

    const panel = await abrirReserva(page, centro, oferta, d, slot, sinPerfil);
    await expect(panel.getByText('Esta persona todavía no es paciente')).toBeVisible();

    const rechazo = respuestaDe(page, 'POST', RESERVA);
    await confirmar(panel).click();
    const respuesta = await rechazo;
    expect(respuesta.status()).toBe(409);
    expect((await problemaDe(respuesta)).type).toBe(uriDeProblema('persona-sin-perfil-paciente'));

    await expect(panel.getByText('No pudimos crear el turno')).toBeVisible();
    // No es un conflicto de lugar: el horario sigue libre y no se ofrecen las salidas de uno.
    await expect(panel.getByText(TITULO_DE_CONFLICTO)).toHaveCount(0);
    await expect(panel.getByText('Opciones disponibles')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Crear sobreturno' })).toHaveCount(0);

    await panel.getByRole('button', { name: 'Activar como paciente' }).first().click();
    await expect(panel.getByText('Esta persona todavía no es paciente')).toHaveCount(0);
    await expect(panel.getByText('No pudimos crear el turno')).toHaveCount(0);

    const creado = respuestaDe(page, 'POST', RESERVA);
    await confirmar(panel).click();
    const turno = await creado;
    expect(turno.status(), await turno.text()).toBe(201);
    await expect(avisos(page).getByText('Turno creado correctamente.')).toBeVisible();
    const { id } = (await turno.json()) as { id: number };
    expect((await verTurno(api, centro, id)).personaId).toBe(sinPerfil.id);
  });

  /**
   * El doble click no crea dos turnos. Con el backend real esto prueba las dos mitades a la vez:
   * que el panel manda la MISMA clave en todos los POST del intento, y que el servidor honra la
   * idempotencia. Se cuenta en el dia de la sede, por la API, cuantos turnos quedaron.
   */
  test('el doble click no crea dos turnos', async ({ page, api, centro }) => {
    const oferta = await crearOferta(api, centro);
    const {
      fecha: d,
      slots: [slot],
    } = await diaDeTrabajo(api, centro, oferta.id, DIAS.reservaDobleClick);
    const persona = await crearPersona(api);

    const claves: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && RESERVA.test(new URL(r.url()).pathname)) {
        claves.push((r.postDataJSON() as { idempotencyKey: string }).idempotencyKey);
      }
    });

    const panel = await abrirReserva(page, centro, oferta, d, slot, persona);
    // Los dos clics en la misma tarea, antes de que la pantalla llegue a apagar el boton. Con `dblclick`
    // el segundo clic gana o pierde esa carrera segun la carga de la maquina, y el test titila.
    await confirmar(panel).evaluate((boton: HTMLButtonElement) => {
      boton.click();
      boton.click();
    });
    const aviso = avisos(page).getByText('Turno creado correctamente.');
    await expect(aviso.first()).toBeVisible();
    await expect(panel).toBeHidden();
    // Se cuenta una sola vez y sin reintentar, despues de darle tiempo al aviso de un segundo POST.
    // `toHaveCount(1)` no sirve: reintenta mientras los dos avisos vencen de a uno y pasa al quedar uno.
    await page.waitForTimeout(1_000);
    // Soft: un aviso de mas no le saca valor a lo que sigue, que es lo que cuida los datos.
    expect.soft(await aviso.count(), 'un solo intento, un solo aviso').toBe(1);

    expect(claves.length).toBeGreaterThan(0);
    expect(new Set(claves).size, `salieron claves distintas: ${claves.join(', ')}`).toBe(1);

    const delDia = await api.exigir<{ turnos: { personaId: number }[] }>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/turnos?fecha=${d}`,
    );
    expect(delDia.turnos.filter((t) => t.personaId === persona.id)).toHaveLength(1);
  });
});
