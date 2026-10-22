import { request as fabricaDeRequest } from '@playwright/test';

import { emailUnico, nonce, sql } from './support/akine';
import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { abrirFiltros } from './support/filtros';
import {
  ApiAkine,
  Centro,
  DIAS,
  MAILPIT,
  crearOferta,
  diaDeTrabajo,
  reservarElPrimeroLibre,
} from './support/sembrado';

/**
 * E2E del listado de notificaciones fallidas con reintento por fila (A-3, web #46) contra el
 * backend REAL.
 *
 * <p>El aviso es real: una persona con correo reserva un turno, el outbox encola `TURNO_RESERVADO`
 * dentro de la transaccion de la reserva y el worker lo entrega a Mailpit.
 *
 * <h2>SEMBRADO DECLARADO: la falla se escribe en la base</h2>
 *
 * <p>Lo unico que no sale de un camino del producto es que el envio FALLE. El backend marca FALLIDA
 * un fallo permanente del SMTP, y contra Mailpit —que acepta cualquier destinatario— no hay forma de
 * provocarlo sin bajar el servidor de correo que comparten los demas specs. Se toma entonces la fila
 * YA ENVIADA y se la pasa a FALLIDA con un motivo por SQL, igual que `activarCuentaPorSql` siembra
 * lo que el producto no expone. Todo lo que sigue —el listado, el reintento, la vuelta a la cola y
 * el segundo envio— es el backend real. El aviso de turno no lleva enlace, asi que el reintento se
 * puede entregar de nuevo (uno de activacion o invitacion moriria AGOTADA por enlace consumido).
 */

interface Notificacion {
  readonly id: number;
  readonly estado: string;
  readonly intentos?: number;
}

/** La fila del outbox del aviso de reserva de ese turno, por su clave idempotente. */
function filaDelOutbox(turnoId: number): { id: number; estado: string } | null {
  const crudo = sql(
    `SELECT id, estado FROM notification_outbox WHERE clave_idempotente='turno-reservado:${turnoId}'`,
  );
  if (crudo === '') {
    return null;
  }
  const [id, estado] = crudo.split('\t');
  return { id: Number(id), estado };
}

async function notificacion(api: ApiAkine, centro: Centro, id: number): Promise<Notificacion> {
  const pagina = await api.exigir<{ content: Notificacion[] }>(
    'GET',
    `/api/v1/organizations/${centro.organizationId}/notifications?estado=PENDIENTE,PROCESANDO,REINTENTABLE,ENVIADA,FALLIDA,AGOTADA&size=100`,
  );
  const fila = pagina.content.find((n) => n.id === id);
  expect(fila, `la notificacion ${id} es de la organizacion`).toBeDefined();
  return fila!;
}

async function correosA(email: string): Promise<number> {
  const correo = await fabricaDeRequest.newContext({ baseURL: MAILPIT });
  try {
    const busqueda = await correo.get('/api/v1/search', { params: { query: `to:"${email}"` } });
    expect(busqueda.ok(), 'Mailpit responde').toBe(true);
    return ((await busqueda.json()) as { messages: unknown[] }).messages.length;
  } finally {
    await correo.dispose();
  }
}

test.describe('Notificaciones fallidas con reintento contra el backend real', () => {
  test('un aviso de turno FALLIDA se lista, se reintenta desde la fila y vuelve a salir', async ({
    page,
    api,
    centro,
  }) => {
    test.slow();
    const email = emailUnico('e2e.aviso');
    const apellido = `Sintetico${nonce()}`;
    const { id: personaId } = await api.exigir<{ id: number }>('POST', '/api/v1/personas', {
      nombre: 'Lucia',
      apellido,
      email,
    });
    await api.exigir('POST', `/api/v1/personas/${personaId}/perfil-paciente`, {});
    const oferta = await crearOferta(api, centro);
    const { slots } = await diaDeTrabajo(api, centro, oferta.id, DIAS.notificacion);
    const turno = await reservarElPrimeroLibre(api, centro, oferta.id, personaId, slots);

    // El worker entrega el aviso: la fila llega a ENVIADA y el correo a Mailpit.
    let fila: { id: number; estado: string } | null = null;
    await expect(async () => {
      fila = filaDelOutbox(turno.id);
      expect(fila?.estado, 'el aviso de reserva se encolo y se envio').toBe('ENVIADA');
    }).toPass({ timeout: 60_000, intervals: [1_000, 2_000] });
    const id = fila!.id;
    await expect.poll(() => correosA(email), { timeout: 30_000 }).toBe(1);

    // Sembrado declarado (ver la cabecera): la entrega falla.
    sql(
      `UPDATE notification_outbox SET estado='FALLIDA', ` +
        `error_sanitizado='Servidor de correo no disponible (sembrado E2E)', updated_at=NOW(6) ` +
        `WHERE id=${id} AND estado='ENVIADA'`,
    );
    expect(filaDelOutbox(turno.id)?.estado).toBe('FALLIDA');

    await ingresar(page, centro);
    await navegar(page, '/organizacion/colaboradores/notificaciones');
    await expect(page.getByRole('heading', { name: 'Notificaciones', level: 1 })).toBeVisible();
    // Por defecto la pantalla muestra FALLIDA y AGOTADA, que son las que se pueden reintentar.
    await abrirFiltros(page);
    await expect(page.getByLabel('Fallida')).toBeChecked();
    await expect(page.getByLabel('Agotada (sin mas intentos)')).toBeChecked();
    await expect(page.getByLabel('Enviada')).not.toBeChecked();

    const tabla = page.getByRole('region', { name: 'Notificaciones de la organizacion' });
    const filaFallida = tabla
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: String(id), exact: true }) });
    await expect(filaFallida).toContainText('Turno reservado');
    await expect(filaFallida).toContainText('Fallida');
    await expect(filaFallida).toContainText('Servidor de correo no disponible (sembrado E2E)');
    // La direccion se muestra enmascarada, nunca completa.
    await expect(filaFallida).not.toContainText(email);

    const reintento = respuestaDe(page, 'POST', /\/notifications\/\d+\/retry$/);
    await filaFallida.getByRole('button', { name: `Reintentar la notificacion ${id}` }).click();
    expect((await reintento).status()).toBeLessThan(300);
    await expect(
      page.getByRole('status').filter({ hasText: `La notificacion ${id} (Turno reservado` }),
    ).toBeVisible();
    // Ya no esta fallida: el listado se relee y la fila sale de la vista por defecto.
    await expect(filaFallida).toHaveCount(0);

    // El worker la vuelve a tomar y la entrega: un segundo correo, sin repetir la reserva.
    await expect
      .poll(async () => (await notificacion(api, centro, id)).estado, { timeout: 60_000 })
      .toBe('ENVIADA');
    await expect.poll(() => correosA(email), { timeout: 30_000 }).toBe(2);

    await page.getByLabel('Enviada').check();
    const enviada = tabla
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: String(id), exact: true }) });
    await expect(enviada).toContainText('Enviada');
    await expect(enviada.getByRole('button', { name: /Reintentar/ })).toHaveCount(0);

    // Reintentar algo que ya salio lo rechaza el servidor: solo FALLIDA o AGOTADA vuelven a la cola.
    const otraVez = await api.pedir(
      'POST',
      `/api/v1/organizations/${centro.organizationId}/notifications/${id}/retry`,
    );
    expect(otraVez.status(), await otraVez.text()).toBe(409);
  });
});
