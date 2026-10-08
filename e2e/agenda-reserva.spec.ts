import { Page } from '@playwright/test';

import {
  RESERVA,
  abrirReserva,
  elegirPersona,
  expect,
  ingresar,
  navegar,
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
 * E2E de la reserva de turno (M12, AKINE-05.02) contra el backend REAL (AKINE E-2).
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
 * <p>Cada test afirma tres cosas: el `type` que emitio el servidor, la accion que ofrece la
 * pantalla, y que no ofrece ninguna de las otras. La tercera es la que impide que las ramas se
 * colapsen en un "no se pudo" generico.
 *
 * <p>Queda fuera `idempotency-key-conflict`: la pantalla genera la clave y no hay forma honesta de
 * hacerle mandar la misma con otro contenido. Lo cubre `reserva-de-turno-page.spec.ts`.
 */

const ACCIONES = {
  recargar: 'Recargar la agenda',
  siguiente: /Tomar el siguiente/,
  otro: 'Elegir otro horario o profesional',
  perfil: 'Activar el perfil de paciente',
} as const;

async function soloSeOfrece(page: Page, esperada: keyof typeof ACCIONES): Promise<void> {
  for (const [nombre, texto] of Object.entries(ACCIONES)) {
    const control = page.getByRole(nombre === 'otro' || nombre === 'perfil' ? 'link' : 'button', {
      name: texto,
    });
    if (nombre === esperada) {
      await expect(control, `el conflicto tiene que ofrecer "${String(texto)}"`).toBeVisible();
    } else {
      await expect(control, `este conflicto NO puede ofrecer "${String(texto)}"`).toHaveCount(0);
    }
  }
}

test.describe('Reserva de turno contra el backend real', () => {
  test.beforeEach(async ({ page, centro }) => {
    await ingresar(page, centro);
  });

  /**
   * El camino feliz completo, desde el buscador. Es el unico test que no entra por URL directa:
   * si el buscador dejara de armar bien la query, este se cae. Al final se relee el turno por la
   * API: un 201 en pantalla no prueba que el turno haya quedado guardado como se ve.
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

    await navegar(page, '/agenda');
    await page.getByLabel('Oferta', { exact: true }).selectOption({ label: oferta.nombre });
    await page.getByLabel('Hasta (sin incluir)').fill(sumarDias(d, 1));
    await page.getByLabel('Desde').fill(d);
    await page.getByRole('button', { name: rango(slot, centro.timezone) }).click();

    await expect(page).toHaveURL(/\/agenda\/ofertas\/\d+\/reservar\?/);
    await expect(page.getByText(rango(slot, centro.timezone))).toBeVisible();
    await expect(page.getByText(`zona ${centro.timezone}`)).toBeVisible();
    await expect(page.getByText(centro.profesional.nombre)).toBeVisible();

    await elegirPersona(page, persona);
    const creado = respuestaDe(page, 'POST', RESERVA);
    await page.getByRole('button', { name: 'Reservar el turno' }).click();
    const { id: turnoId } = (await (await creado).json()) as { id: number };
    await expect(page.getByRole('heading', { name: 'Turno RESERVADO', level: 2 })).toBeVisible();
    await expect(page.getByText('Todavia falta confirmarlo')).toBeVisible();

    await page.getByRole('button', { name: 'Confirmar el turno' }).click();
    await expect(page.getByRole('heading', { name: 'Turno CONFIRMADO', level: 2 })).toBeVisible();

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

    await abrirReserva(page, oferta, d, primero, persona);
    // Otra recepcionista se lo gana entre la lectura y la escritura.
    await reservar(api, centro, oferta.id, (await crearPersona(api)).id, primero.desde);

    const rechazo = respuestaDe(page, 'POST', RESERVA);
    await page.getByRole('button', { name: 'Reservar el turno' }).click();
    const respuesta = await rechazo;
    expect(respuesta.status()).toBe(409);
    const problema = await problemaDe(respuesta);
    expect(problema.type).toBe(uriDeProblema('slot-completo'));
    expect(problema['cupoTotal']).toBe(1);

    await soloSeOfrece(page, 'siguiente');
    await expect(
      page.getByText('Ese horario admite 1 reservas y ya no queda ninguna.'),
    ).toBeVisible();

    await page
      .getByRole('button', { name: `Tomar el siguiente: ${hora(segundo.desde, centro.timezone)}` })
      .click();
    await expect(page.getByRole('heading', { name: 'No se pudo reservar' })).toHaveCount(0);
    await expect(page.getByText(rango(segundo, centro.timezone))).toBeVisible();

    const creado = respuestaDe(page, 'POST', RESERVA);
    await page.getByRole('button', { name: 'Reservar el turno' }).click();
    const turno = (await (await creado).json()) as { id: number };
    await expect(page.getByRole('heading', { name: 'Turno RESERVADO', level: 2 })).toBeVisible();
    expect((await verTurno(api, centro, turno.id)).inicio).toBe(segundo.desde);
  });

  test('slot-no-disponible muestra lo que cambio y recargar relee la agenda', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const {
      fecha: d,
      slots: [slot],
    } = await diaDeTrabajo(api, centro, oferta.id, DIAS.reservaNoDisponible);

    await abrirReserva(page, oferta, d, slot, await crearPersona(api));
    // El profesional pide el dia despues de que la recepcion abrio la reserva.
    await api.exigir('POST', `/api/v1/consultorios/${centro.consultorioId}/excepciones`, {
      tipo: 'CIERRE',
      motivo: 'AUSENCIA',
      membershipId: centro.profesional.membershipId,
      fechaDesde: d,
      fechaHasta: sumarDias(d, 1),
    });

    const rechazo = respuestaDe(page, 'POST', RESERVA);
    await page.getByRole('button', { name: 'Reservar el turno' }).click();
    const respuesta = await rechazo;
    expect(respuesta.status()).toBe(409);
    const problema = await problemaDe(respuesta);
    expect(problema.type).toBe(uriDeProblema('slot-no-disponible'));
    expect(typeof problema['motivo']).toBe('string');

    await soloSeOfrece(page, 'recargar');
    await expect(page.getByText(`Lo que cambio: ${String(problema['motivo'])}`)).toBeVisible();

    await page.getByRole('button', { name: 'Recargar la agenda' }).click();
    await expect(page.getByRole('heading', { name: 'No se pudo reservar' })).toHaveCount(0);
    await expect(
      page.getByText('Ese horario ya no figura en la agenda de este dia.'),
    ).toBeVisible();
  });

  test('recurso-ocupado nombra al profesional y manda a elegir otro horario', async ({
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

    await abrirReserva(page, oferta, d, slot, await crearPersona(api));
    // El mismo profesional, a la misma hora, en otra oferta.
    await reservar(api, centro, otraOferta.id, (await crearPersona(api)).id, slot.desde);

    const rechazo = respuestaDe(page, 'POST', RESERVA);
    await page.getByRole('button', { name: 'Reservar el turno' }).click();
    const respuesta = await rechazo;
    expect(respuesta.status()).toBe(409);
    const problema = await problemaDe(respuesta);
    expect(problema.type).toBe(uriDeProblema('recurso-ocupado'));
    expect(problema['recurso']).toBe('profesional');

    await soloSeOfrece(page, 'otro');
    await expect(page.getByText('El recurso ocupado es el')).toBeVisible();

    await page.getByRole('link', { name: 'Elegir otro horario o profesional' }).click();
    await expect(page).toHaveURL(/\/agenda$/);
  });

  test('persona-sin-perfil-paciente manda al padron a activar el perfil', async ({
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

    await abrirReserva(page, oferta, d, slot, sinPerfil);

    const rechazo = respuestaDe(page, 'POST', RESERVA);
    await page.getByRole('button', { name: 'Reservar el turno' }).click();
    const respuesta = await rechazo;
    expect(respuesta.status()).toBe(409);
    expect((await problemaDe(respuesta)).type).toBe(uriDeProblema('persona-sin-perfil-paciente'));

    await soloSeOfrece(page, 'perfil');
    await page.getByRole('link', { name: 'Activar el perfil de paciente' }).click();
    await expect(page).toHaveURL(/\/pacientes/);
  });

  /**
   * El doble click no crea dos turnos. Con el backend real esto prueba las dos mitades a la vez:
   * que la pantalla manda la MISMA clave en todos los POST del intento, y que el servidor honra
   * la idempotencia. Se cuenta en el dia de la sede, por la API, cuantos turnos quedaron.
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

    await abrirReserva(page, oferta, d, slot, persona);
    await page.getByRole('button', { name: 'Reservar el turno' }).dblclick();
    await expect(page.getByRole('heading', { name: 'Turno RESERVADO', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Turno /, level: 2 })).toHaveCount(1);

    expect(claves.length).toBeGreaterThan(0);
    expect(new Set(claves).size, `salieron claves distintas: ${claves.join(', ')}`).toBe(1);

    const delDia = await api.exigir<{ turnos: { personaId: number }[] }>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/turnos?fecha=${d}`,
    );
    expect(delDia.turnos.filter((t) => t.personaId === persona.id)).toHaveLength(1);
  });
});
