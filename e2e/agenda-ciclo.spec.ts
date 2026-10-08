import { Page } from '@playwright/test';

import {
  RESERVA,
  abrirReserva,
  expect,
  ingresar,
  problemaDe,
  respuestaDe,
  test,
} from './support/agenda-real';
import {
  DIAS,
  Oferta,
  Persona,
  Slot,
  agendaDe,
  crearOferta,
  crearPersona,
  diaDeTrabajo,
  rango,
  uriDeProblema,
  verTurno,
} from './support/sembrado';

/**
 * E2E del ciclo del turno (M12, AKINE-05.03) contra el backend REAL (AKINE E-2):
 * reservar → confirmar → cancelar, reservar → mover a otro horario, y el 409 de un turno que otra
 * persona toco mientras la pantalla estaba abierta.
 *
 * <p>Se llega al ciclo por el enlace de la reserva, que es la puerta de entrada que tiene el
 * producto, y no por URL armada a mano: ese enlace es el que lleva `version`, `ofertaId` y `fecha`.
 * Despues de cada transicion se relee el turno por la API, porque lo que la pantalla dice no
 * prueba lo que quedo guardado.
 */

/** Reserva por pantalla y entra al ciclo del turno por su enlace. Devuelve el id del turno. */
async function reservarYAbrirElCiclo(
  page: Page,
  oferta: Oferta,
  fecha: string,
  slot: Slot,
  persona: Persona,
): Promise<number> {
  await abrirReserva(page, oferta, fecha, slot, persona);
  const creado = respuestaDe(page, 'POST', RESERVA);
  await page.getByRole('button', { name: 'Reservar el turno' }).click();
  const { id } = (await (await creado).json()) as { id: number };
  await expect(page.getByRole('heading', { name: 'Turno RESERVADO', level: 2 })).toBeVisible();

  await page
    .getByRole('link', { name: 'Cancelar, mover o ver el historial de este turno' })
    .click();
  await expect(page.getByRole('heading', { name: `Turno #${id}`, level: 1 })).toBeVisible();
  return id;
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
    const turnoId = await reservarYAbrirElCiclo(page, oferta, fecha, slot, await crearPersona(api));

    await page.getByRole('button', { name: 'Confirmar el turno' }).click();
    await expect(page.getByText(/^Confirmado/)).toBeVisible();

    await page.getByRole('button', { name: 'Cancelar el turno' }).click();
    // Sin motivo no se cancela (DP-04): el boton no emite y el panel lo dice.
    await page.getByLabel('Motivo de la cancelacion').fill('El paciente aviso que viaja');
    await page.getByRole('button', { name: 'Cancelar el turno' }).click();

    await expect(page.getByText('Turno cancelado. El lugar se libero')).toBeVisible();
    await expect(page.getByText(/^Cancelado/).first()).toBeVisible();
    // El historial conserva el motivo y la transicion: nada se borra.
    await expect(page.getByText('El paciente aviso que viaja')).toBeVisible();
    await expect(page.getByText('CONFIRMADO → CANCELADO')).toBeVisible();

    expect((await verTurno(api, centro, turnoId)).estado).toBe('CANCELADO');
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
    const turnoId = await reservarYAbrirElCiclo(
      page,
      oferta,
      fecha,
      origen,
      await crearPersona(api),
    );

    await page.getByRole('button', { name: 'Mover a otro horario' }).click();
    await expect(page.getByLabel('Dia destino')).toHaveValue(fecha);
    await page.getByRole('button', { name: rango(destino, centro.timezone) }).click();
    await page.getByLabel('Motivo del cambio').fill('El profesional llega mas tarde');
    await page.getByRole('button', { name: 'Mover el turno' }).click();

    await expect(page.getByText('Venia de')).toBeVisible();
    await expect(page.getByText('El profesional llega mas tarde')).toBeVisible();

    const movido = await verTurno(api, centro, turnoId);
    expect(movido.id, 'es el MISMO turno, no uno nuevo').toBe(turnoId);
    expect(movido.inicio).toBe(destino.desde);
    expect(movido.estado).toBe('RESERVADO');
  });

  /**
   * Otra recepcionista mueve el turno mientras esta pantalla lo tiene abierto. Cancelar con la
   * version vieja tiene que rebotar con 409 —no pisar lo que hizo la otra— y "Releer el turno"
   * tiene que dejar la pantalla en condiciones de operar con la version nueva.
   */
  test('un turno tocado por otra persona rebota con 409, y releerlo destraba la operacion', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const {
      fecha,
      slots: [slot, otro],
    } = await diaDeTrabajo(api, centro, oferta.id, DIAS.cicloConflicto);
    const turnoId = await reservarYAbrirElCiclo(page, oferta, fecha, slot, await crearPersona(api));

    // Una transicion desde esta pantalla: de aca en mas la version que conoce es la de esa
    // respuesta, que es justamente la que va a quedar vieja.
    await page.getByRole('button', { name: 'Confirmar el turno' }).click();
    await expect(page.getByText(/^Confirmado/)).toBeVisible();

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

    await page.getByRole('button', { name: 'Cancelar el turno' }).click();
    await page.getByLabel('Motivo de la cancelacion').fill('Intento con la version vieja');
    const rechazo = respuestaDe(page, 'POST', /\/turnos\/\d+\/cancelacion$/);
    await page.getByRole('button', { name: 'Cancelar el turno' }).click();
    const respuesta = await rechazo;
    expect(respuesta.status()).toBe(409);
    const problema = await problemaDe(respuesta);
    // `conflict` y no `concurrent-modification`: es la decision transversal pendiente del workspace
    // (los dos tipos conviven). Se afirma lo que el backend emite hoy.
    expect(problema.type).toBe(uriDeProblema('conflict'));

    await expect(
      page.getByRole('heading', { name: 'No se pudo operar sobre el turno' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Releer el turno' }).click();
    await expect(
      page.getByRole('heading', { name: 'No se pudo operar sobre el turno' }),
    ).toHaveCount(0);
    // Releido: la pantalla ya sabe que lo movieron y vuelve a estar RESERVADO.
    await expect(page.getByText(/^Reservado/)).toBeVisible();

    // El panel sigue abierto con lo escrito: se corrige el motivo y se reintenta.
    await page.getByLabel('Motivo de la cancelacion').fill('Ahora con la version vigente');
    await page.getByRole('button', { name: 'Cancelar el turno' }).click();
    await expect(page.getByText('Turno cancelado. El lugar se libero')).toBeVisible();
    expect((await verTurno(api, centro, turnoId)).estado).toBe('CANCELADO');
  });
});
