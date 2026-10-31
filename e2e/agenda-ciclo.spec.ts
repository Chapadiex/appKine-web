import { Locator, Page } from '@playwright/test';

import {
  RESERVA,
  abrirReserva,
  avisos,
  expect,
  ingresar,
  navegar,
  panelDeTurno,
  problemaDe,
  respuestaDe,
  test,
} from './support/agenda-real';
import { cerrarAvisos } from './support/avisos';
import { abrirAcciones } from './support/filtros';
import {
  Centro,
  DIAS,
  Oferta,
  Persona,
  Slot,
  agendaDe,
  crearOferta,
  crearPersona,
  diaDeTrabajo,
  hora,
  rango,
  reservar,
  uriDeProblema,
  verTurno,
} from './support/sembrado';

/**
 * E2E del ciclo del turno (M12, AKINE-05.03) en el panel del flujo unico, contra el backend REAL (AKINE
 * E-2): reservar → confirmar → cancelar, reservar → mover a otro horario, el 409 de un turno que otra
 * persona toco mientras el panel estaba abierto y la direccion `/agenda/turnos/:turnoId`.
 *
 * <p>Se reserva por el panel y se entra por "Ver el turno" de la recepcion del dia, que es una de las
 * puertas de entrada que tiene el producto, y no por URL armada a mano. Abrir el turno no saca a nadie
 * de donde estaba: el test lo afirma. Despues de cada transicion se relee el turno por la API, porque
 * lo que el panel dice no prueba lo que quedo guardado.
 *
 * <p>El camino feliz desde la agenda (reprogramar y cancelar) lo cubre `flujo-unico-de-turnos.spec.ts`.
 */

/** Reserva por pantalla y abre el panel del turno desde la recepcion. */
async function reservarYAbrirElPanel(
  page: Page,
  centro: Centro,
  oferta: Oferta,
  fecha: string,
  slot: Slot,
  persona: Persona,
): Promise<{ turnoId: number; detalle: Locator }> {
  const panel = await abrirReserva(page, centro, oferta, fecha, slot, persona);
  const creado = respuestaDe(page, 'POST', RESERVA);
  await panel.getByRole('button', { name: 'Confirmar turno' }).click();
  const { id } = (await (await creado).json()) as { id: number };
  await expect(avisos(page).getByText('Turno creado correctamente.')).toBeVisible();
  await expect(panel).toBeHidden();
  await cerrarAvisos(page);

  const recepcion = `/agenda/recepcion?fecha=${fecha}`;
  await navegar(page, recepcion);
  await page.getByLabel('Paciente o documento').fill(persona.apellido);
  const fila = page.getByRole('row').filter({ hasText: persona.apellido });
  await abrirAcciones(fila);
  await fila.getByRole('button', { name: `Ver el turno de ${persona.apellido}` }).click();

  const detalle = panelDeTurno(page, 'Turno');
  await expect(detalle.locator('.estado-turno')).toContainText('Reservado');
  // El panel se abre sobre la recepcion: ni la direccion ni la busqueda cambiaron.
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(recepcion);
  await expect(page.getByLabel('Paciente o documento')).toHaveValue(persona.apellido);
  return { turnoId: id, detalle };
}

test.describe('Ciclo del turno contra el backend real', () => {
  test.beforeEach(async ({ page, centro }) => {
    await ingresar(page, centro);
  });

  test('reservar, confirmar y cancelar con motivo: el lugar vuelve a la agenda', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const {
      fecha,
      slots: [slot],
    } = await diaDeTrabajo(api, centro, oferta.id, DIAS.cicloCancelar);
    const { turnoId, detalle } = await reservarYAbrirElPanel(
      page,
      centro,
      oferta,
      fecha,
      slot,
      await crearPersona(api),
    );

    await detalle.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(detalle.locator('.estado-turno')).toContainText('Confirmado');
    await cerrarAvisos(page);

    await detalle.getByText('Más acciones').click();
    await detalle.getByRole('button', { name: 'Cancelar turno' }).click();
    // "Otro" solo no es un motivo (DP-04): hasta que se escribe, no se puede mandar.
    await detalle.getByLabel('Motivo', { exact: true }).selectOption('Otro');
    await expect(detalle.getByRole('button', { name: 'Cancelar turno' })).toBeDisabled();
    await detalle.getByLabel('Observación (obligatoria)').fill('El paciente aviso que viaja');
    await detalle.getByRole('button', { name: 'Cancelar turno' }).click();

    // UX-12: el resultado es un aviso global, en la region de notificaciones.
    await expect(avisos(page).getByText('Turno cancelado')).toBeVisible();
    await expect(detalle.locator('.estado-turno')).toContainText('Cancelado');
    await cerrarAvisos(page);

    // El historial conserva el motivo y la transicion: nada se borra.
    await detalle.getByText('Más acciones').click();
    await detalle.getByRole('button', { name: 'Ver historial' }).click();
    const historial = panelDeTurno(page, 'Historial del turno');
    await expect(historial.getByText('Otro: El paciente aviso que viaja')).toBeVisible();
    await expect(historial.getByText('Confirmado → Cancelado')).toBeVisible();

    const guardado = await api.exigir<{ estado: string; motivoCancelacion: string }>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/turnos/${turnoId}`,
    );
    expect(guardado.estado).toBe('CANCELADO');
    expect(guardado.motivoCancelacion).toBe('Otro: El paciente aviso que viaja');
    const [dia] = await agendaDe(api, centro, oferta.id, fecha);
    expect(
      dia.slots.find((s) => s.desde === slot.desde)?.cupoLibre,
      'cancelar libera el lugar (RN-M12-002)',
    ).toBe(1);
  });

  test('mover a otro horario conserva el turno y deja de donde vino en el historial', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const {
      fecha,
      slots: [origen, , destino],
    } = await diaDeTrabajo(api, centro, oferta.id, DIAS.cicloReprogramar);
    const { turnoId, detalle } = await reservarYAbrirElPanel(
      page,
      centro,
      oferta,
      fecha,
      origen,
      await crearPersona(api),
    );

    await detalle.getByText('Más acciones').click();
    await detalle.getByRole('button', { name: 'Reprogramar' }).click();
    const reprogramar = panelDeTurno(page, 'Reprogramar turno');

    // El horario se busca desde el dia que se quiere: los proximos libres pueden ser otros.
    const busqueda = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith('/disponibilidad/busqueda') &&
        (r.request().postDataJSON() as { desde?: string }).desde === fecha,
    );
    await reprogramar.getByLabel('Desde').fill(fecha);
    await busqueda;
    await reprogramar.getByRole('button', { name: rango(destino, centro.timezone) }).click();
    await reprogramar.getByLabel('Observación (opcional)').fill('El profesional llega mas tarde');
    await reprogramar.getByRole('button', { name: 'Reprogramar' }).click();
    await expect(avisos(page).getByText('Turno reprogramado correctamente.')).toBeVisible();
    await cerrarAvisos(page);

    await detalle.getByText('Más acciones').click();
    await detalle.getByRole('button', { name: 'Ver historial' }).click();
    const historial = panelDeTurno(page, 'Historial del turno');
    await expect(
      historial.getByText(/De \d\d\/\d\d\/\d{4}, .* a \d\d\/\d\d\/\d{4}, /),
    ).toBeVisible();
    await expect(historial.getByText(/El profesional llega mas tarde/)).toBeVisible();

    const movido = await verTurno(api, centro, turnoId);
    expect(movido.id, 'es el MISMO turno, no uno nuevo').toBe(turnoId);
    expect(movido.inicio).toBe(destino.desde);
    expect(movido.estado).toBe('RESERVADO');
  });

  /**
   * Otra recepcionista mueve el turno mientras este panel lo tiene abierto y se intenta reprogramarlo.
   * La version vieja tiene que rebotar con 409 —no pisar lo que hizo la otra— y el panel se tiene que
   * releer solo: si no, el reintento manda la misma version y el 409 no tiene salida.
   */
  test('reprogramar un turno que tocó otra persona rebota con 409, y el reintento vale', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const {
      fecha,
      slots: [slot, otro, , destino],
    } = await diaDeTrabajo(api, centro, oferta.id, DIAS.cicloConflicto);
    const { turnoId, detalle } = await reservarYAbrirElPanel(
      page,
      centro,
      oferta,
      fecha,
      slot,
      await crearPersona(api),
    );

    // Una transicion desde el panel: de aca en mas la version que conoce es la de esa relectura, que
    // es justamente la que va a quedar vieja.
    await detalle.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(detalle.locator('.estado-turno')).toContainText('Confirmado');
    await cerrarAvisos(page);

    await detalle.getByText('Más acciones').click();
    await detalle.getByRole('button', { name: 'Reprogramar' }).click();
    const reprogramar = panelDeTurno(page, 'Reprogramar turno');
    const buscar = (): Promise<unknown> =>
      page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/disponibilidad/busqueda'));
    const primera = buscar();
    await reprogramar.getByLabel('Desde').fill(fecha);
    await primera;
    const elegir = reprogramar.getByRole('button', { name: rango(destino, centro.timezone) });
    await elegir.click();

    const leido = await verTurno(api, centro, turnoId);
    await api.exigir(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/turnos/${turnoId}/reprogramacion`,
      {
        inicio: otro.desde,
        profesionalId: centro.profesional.membershipId,
        motivo: 'Lo movio otra recepcionista',
        expectedVersion: leido.version,
      },
    );

    const rechazo = respuestaDe(page, 'POST', /\/turnos\/\d+\/reprogramacion$/);
    const relectura = page.waitForResponse(
      (r) => r.request().method() === 'GET' && r.url().endsWith(`/turnos/${turnoId}`),
    );
    const segunda = buscar();
    await reprogramar.getByRole('button', { name: 'Reprogramar' }).click();
    const respuesta = await rechazo;
    expect(respuesta.status()).toBe(409);
    // Desde DP-21 (appKine-api #74) toda version vieja es `concurrent-modification`.
    expect((await problemaDe(respuesta)).type).toBe(uriDeProblema('concurrent-modification'));
    await Promise.all([relectura, segunda]);

    await expect(reprogramar.getByText('No se pudo completar la acción')).toBeVisible();
    // Releido: el resumen ya dice el horario al que lo movio la otra persona.
    await expect(reprogramar.locator('.flujo__resumen-titulo')).toContainText(
      hora(otro.desde, centro.timezone),
    );

    await elegir.click();
    await reprogramar.getByRole('button', { name: 'Reprogramar' }).click();
    await expect(avisos(page).getByText('Turno reprogramado correctamente.')).toBeVisible();
    expect((await verTurno(api, centro, turnoId)).inicio).toBe(destino.desde);
  });

  /**
   * Lo mismo con cancelar, desde la agenda: otra recepcionista lo mueve mientras el panel esta abierto.
   * La version vieja rebota, el panel se relee solo y el mismo boton, ahora con la version vigente,
   * cancela.
   */
  test('en el panel del turno una version vieja rebota con 409, y el panel se relee', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const { fecha, slots } = await diaDeTrabajo(api, centro, oferta.id, DIAS.cicloConflicto);
    // Lejos de los horarios del test anterior: es el mismo dia y el mismo profesional.
    const [slot, otro] = [slots[6], slots[7]];
    const persona = await crearPersona(api);
    const turno = await reservar(api, centro, oferta.id, persona.id, slot.desde);

    await navegar(page, `/agenda?fecha=${fecha}`);
    await page
      .getByRole('button', {
        name: new RegExp(`^${hora(slot.desde, centro.timezone)} a .*${persona.apellido}`),
      })
      .click();
    const detalle = panelDeTurno(page, 'Turno');
    await expect(detalle.locator('.estado-turno')).toContainText('Reservado');

    await api.exigir(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/turnos/${turno.id}/reprogramacion`,
      {
        inicio: otro.desde,
        profesionalId: centro.profesional.membershipId,
        motivo: 'Lo movio otra recepcionista',
        expectedVersion: turno.version,
      },
    );

    await detalle.getByText('Más acciones').click();
    await detalle.getByRole('button', { name: 'Cancelar turno' }).click();
    const rechazo = respuestaDe(page, 'POST', /\/turnos\/\d+\/cancelacion$/);
    await detalle.getByRole('button', { name: 'Cancelar turno' }).click();
    const respuesta = await rechazo;
    expect(respuesta.status()).toBe(409);
    expect((await problemaDe(respuesta)).type).toBe(uriDeProblema('concurrent-modification'));

    await expect(detalle.getByText('No se pudo completar la acción')).toBeVisible();
    // Releido: el panel ya sabe que lo movieron, y el turno sigue vivo.
    await expect(detalle.locator('.flujo__resumen-titulo')).toContainText(
      hora(otro.desde, centro.timezone),
    );
    expect((await verTurno(api, centro, turno.id)).estado).toBe('RESERVADO');

    await detalle.getByRole('button', { name: 'Cancelar turno' }).click();
    await expect(avisos(page).getByText('Turno cancelado')).toBeVisible();
    expect((await verTurno(api, centro, turno.id)).estado).toBe('CANCELADO');
  });

  /**
   * La direccion vieja del turno: hay enlaces guardados. Se entra con la pagina recien cargada, que es
   * como se abre un enlace, y ahi la zona de la sede todavia no volvio: las horas y el dia tienen que
   * salir bien igual.
   */
  test('la direccion del turno abre la agenda en su dia con el panel encima', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const { fecha, slots } = await diaDeTrabajo(api, centro, oferta.id, DIAS.cicloCancelar);
    const slot = slots[4];
    const persona = await crearPersona(api);
    const turno = await reservar(api, centro, oferta.id, persona.id, slot.desde);

    await page.goto(`/agenda/turnos/${turno.id}`);

    const detalle = panelDeTurno(page, 'Turno');
    await expect(detalle.locator('.estado-turno')).toContainText('Reservado');
    await expect(detalle.locator('.flujo__resumen-titulo')).toContainText(
      hora(slot.desde, centro.timezone),
    );
    await expect(page).toHaveURL(new RegExp(`/agenda\\?(.*&)?fecha=${fecha}`));
    await expect(detalle.getByRole('heading', { name: 'Turno', exact: true })).toBeVisible();

    // Atras la grilla esta en el dia del turno: cerrar el panel deja a la vista ese turno.
    await detalle.getByRole('button', { name: 'Cerrar el panel' }).click();
    await expect(detalle).toBeHidden();
    await expect(
      page.getByRole('button', {
        name: new RegExp(`^${hora(slot.desde, centro.timezone)} a .*${persona.apellido}`),
      }),
    ).toBeVisible();
  });

  test('la direccion de un turno que no existe muestra el error del panel, no una pantalla en blanco', async ({
    page,
  }) => {
    await page.goto('/agenda/turnos/999999999');

    const detalle = panelDeTurno(page, 'Turno');
    await expect(detalle.getByText('No pudimos abrir el turno')).toBeVisible();
    await expect(detalle.getByText('Este turno no existe, o es de otra sede.')).toBeVisible();
    await expect(page).toHaveURL(/\/agenda(\?|$)/);

    // Y atras esta la agenda, lista para seguir.
    await detalle.getByRole('button', { name: 'Cerrar el panel' }).click();
    await expect(page.getByRole('button', { name: 'Nuevo turno', exact: true })).toBeVisible();
  });
});
