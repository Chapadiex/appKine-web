import { randomUUID } from 'node:crypto';

import { expect, ingresar, navegar, problemaDe, respuestaDe, test } from './support/agenda-real';
import {
  Oferta,
  Persona,
  Turno,
  crearOferta,
  crearPersona,
  exigirPrepago,
  fechaLocal,
  turnoDeHoy,
  uriDeProblema,
  verTurno,
} from './support/sembrado';

/**
 * E2E del prepago como anticipo (E-6, DP-06 / ADR-0013) y visible antes del check-in (E-8),
 * contra el backend REAL.
 *
 * <p>La oferta exige prepago y el turno es de HOY (la recepcion solo opera el dia). Antes de que
 * el paciente llegue, la fila ya avisa "Prepago pendiente"; el mostrador lo registra desde ahi y
 * al volver la fila dice "Prepago registrado", sin haber registrado la llegada.
 *
 * <p>El medio es TRANSFERENCIA a proposito: el efectivo necesita la caja abierta, y la caja de la
 * sede es una sola y la opera `flujo-caja.spec.ts`. Un anticipo por transferencia no toca el cajon.
 */

/** Entra a la recepcion como entra el mostrador: desde la agenda. */
async function abrirLaRecepcion(page: import('@playwright/test').Page, persona: Persona) {
  await navegar(page, '/agenda');
  await page.getByRole('link', { name: 'Ver la recepcion del dia' }).click();
  await expect(page.getByRole('heading', { name: 'Recepcion del dia', level: 1 })).toBeVisible();
  const fila = page.getByRole('row').filter({ hasText: persona.apellido });
  await expect(fila).toBeVisible();
  return fila;
}

test.describe('Prepago antes del check-in contra el backend real', () => {
  let oferta: Oferta;
  let persona: Persona;
  let turno: Turno;

  test.beforeEach(async ({ page, api, centro }) => {
    // Sin habilitaciones explicitas: una cargada hoy no vale para hoy (ver `crearOferta`).
    const creada = await crearOferta(api, centro, {
      habilitarProfesional: false,
      duracionMinutos: 15,
    });
    oferta = await exigirPrepago(api, centro, creada);
    persona = await crearPersona(api);
    const reservado = await turnoDeHoy(api, centro, oferta, persona);
    test.skip(
      reservado === null,
      `no queda ningun horario futuro hoy (${fechaLocal(centro.timezone)}) en ${centro.timezone}`,
    );
    turno = reservado!;
    await ingresar(page, centro);
  });

  test('la recepcion avisa PENDIENTE sin llegada, se registra el anticipo y pasa a REGISTRADO', async ({
    page,
    api,
    centro,
  }) => {
    const antes = await verTurno(api, centro, turno.id);
    expect((antes as { prepago?: { estado: string } }).prepago?.estado).toBe('PENDIENTE');

    const fila = await abrirLaRecepcion(page, persona);
    await expect(fila.getByText('Sin recepcion')).toBeVisible();
    await expect(fila.getByText('Prepago pendiente', { exact: true })).toBeVisible();

    await fila.getByRole('link', { name: 'Registrar prepago' }).click();
    await expect(
      page.getByRole('heading', { name: 'Registrar un prepago', level: 1 }),
    ).toBeVisible();

    // La oferta no tiene precio: no hay importe ni moneda sugeridos, los decide quien cobra.
    await page.getByLabel('Moneda del prepago').fill('ARS');
    await page.getByLabel('Medio de pago').selectOption({ label: 'Transferencia' });
    await page.getByLabel('Importe recibido').fill('2500');
    await page.getByLabel('Referencia (opcional)').fill(`TRF-${turno.id}`);

    const alta = respuestaDe(page, 'POST', /\/cobros$/);
    await page.getByRole('button', { name: 'Registrar el prepago' }).click();
    expect((await alta).status()).toBe(201);

    await expect(page.getByRole('heading', { name: 'Cobro registrado' })).toBeVisible();
    await expect(page.getByText(/Ninguna todavia: es un anticipo del turno/)).toBeVisible();

    await page.getByRole('link', { name: 'Volver a la recepcion del dia' }).first().click();
    await expect(page.getByRole('heading', { name: 'Recepcion del dia', level: 1 })).toBeVisible();
    const despues = page.getByRole('row').filter({ hasText: persona.apellido });
    await expect(despues.getByText('Prepago registrado', { exact: true })).toBeVisible();
    // Sigue sin llegada: el prepago no es el check-in.
    await expect(despues.getByText('Sin recepcion')).toBeVisible();
    await expect(despues.getByRole('link', { name: 'Registrar prepago' })).toHaveCount(0);

    const guardado = (await verTurno(api, centro, turno.id)) as Turno & {
      prepago?: { estado: string; importe?: number; cobroId?: number };
    };
    expect(guardado.prepago?.estado).toBe('REGISTRADO');
    expect(guardado.prepago?.importe).toBe(2500);
    expect(guardado.estado).toBe('RESERVADO');

    // Un segundo anticipo para el mismo turno lo rechaza el servidor con su tipo propio.
    const segundo = await api.pedir('POST', `/api/v1/consultorios/${centro.consultorioId}/cobros`, {
      personaId: persona.id,
      total: 2500,
      anticipo: 2500,
      moneda: 'ARS',
      medios: [{ medio: 'TRANSFERENCIA', importe: 2500 }],
      imputaciones: [],
      turnoId: turno.id,
      idempotencyKey: randomUUID(),
    });
    expect(segundo.status(), await segundo.text()).toBe(409);
    expect(((await segundo.json()) as { type: string }).type).toBe(
      uriDeProblema('prepago-ya-registrado'),
    );
  });

  test('un prepago sobre un turno cancelado lo rechaza el servidor con prepago-no-admitido', async ({
    page,
    api,
    centro,
  }) => {
    // La pantalla ofrece el enlace con el turno vivo; otra persona lo cancela antes de cobrar.
    const fila = await abrirLaRecepcion(page, persona);
    await fila.getByRole('link', { name: 'Registrar prepago' }).click();
    await expect(
      page.getByRole('heading', { name: 'Registrar un prepago', level: 1 }),
    ).toBeVisible();

    await api.exigir(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/turnos/${turno.id}/cancelacion`,
      { motivo: 'Cancelo por telefono', expectedVersion: turno.version },
    );

    await page.getByLabel('Moneda del prepago').fill('ARS');
    await page.getByLabel('Medio de pago').selectOption({ label: 'Transferencia' });
    await page.getByLabel('Importe recibido').fill('1000');

    const rechazo = respuestaDe(page, 'POST', /\/cobros$/);
    await page.getByRole('button', { name: 'Registrar el prepago' }).click();
    const respuesta = await rechazo;
    expect(respuesta.status()).toBe(409);
    expect((await problemaDe(respuesta)).type).toBe(uriDeProblema('prepago-no-admitido'));

    await expect(page.getByRole('heading', { name: 'No se registro el cobro' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Volver a la recepcion del dia' }).last(),
    ).toBeVisible();
  });
});
