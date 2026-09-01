import { Page, expect, test } from '@playwright/test';

import {
  ApiDeTurnos,
  FECHA,
  NOMBRE_OFERTA,
  NOMBRE_PROFESIONAL,
  PERSONA_CON_PERFIL,
  creado,
  instalarApiDeTurnos,
  instante,
  ok,
  problema,
  turno,
  urlDeReserva,
} from './support/agenda-simulada';

/**
 * E2E de la reserva de turno (M12, AKINE-05.02).
 *
 * <p>Cubre el camino feliz completo y —sobre todo— los caminos que fallan, que es donde un E2E
 * paga. El corazon de la etapa es que <b>los cuatro conflictos llevan a cuatro acciones
 * distintas</b>: es la razon por la que el backend los publica como tipos separados y no como un
 * `conflict` generico. Por eso cada test de conflicto afirma dos cosas, y la segunda es la que
 * importa: que aparece <b>su</b> accion, y que <b>no aparece ninguna de las otras tres</b>. Un
 * test que solo verificara "muestra un error" pasaria igual con las cuatro ramas colapsadas.
 *
 * <p>El alcance y los limites del harness estan en `support/agenda-simulada.ts`.
 */

/** Los cuatro botones de salida, uno por conflicto. Ninguno puede aparecer fuera de su caso. */
const ACCIONES = {
  recargar: 'Recargar la agenda',
  siguiente: /Tomar el siguiente/,
  otro: 'Elegir otro horario o profesional',
  perfil: 'Activar el perfil de paciente',
} as const;

/** Falla si aparece alguna accion que no sea la de este conflicto. */
async function soloSeOfrece(page: Page, esperada: keyof typeof ACCIONES): Promise<void> {
  for (const [nombre, texto] of Object.entries(ACCIONES)) {
    const control = page.getByRole(nombre === 'otro' || nombre === 'perfil' ? 'link' : 'button', {
      name: texto,
    });
    if (nombre === esperada) {
      await expect(control, `el conflicto tiene que ofrecer "${String(texto)}"`).toBeVisible();
    } else {
      await expect(
        control,
        `este conflicto NO puede ofrecer "${String(texto)}": llevaria a otra accion`,
      ).toHaveCount(0);
    }
  }
}

/**
 * Escribe en el buscador del padron como lo haria una persona.
 *
 * <p>El `Enter` no es decorativo: el campo escucha `(change)`, que en un navegador real solo salta
 * al salir del campo o al confirmar. `fill` de Playwright dispara `input` y nada mas, asi que sin
 * el Enter la busqueda nunca sale y el test verificaria una pantalla que el usuario no ve.
 */
async function buscarEnElPadron(page: Page, texto: string): Promise<void> {
  const campo = page.getByLabel('Documento, apellido, nombre o telefono');
  await campo.fill(texto);
  await campo.press('Enter');
}

/** Abre la reserva de un slot y elige a quien se le reserva. Deja todo listo para reservar. */
async function llegarConPersonaElegida(page: Page, horaLocal = '09:00'): Promise<void> {
  await page.goto(urlDeReserva(FECHA, horaLocal));
  await expect(page.getByRole('heading', { name: 'Resumen', level: 2 })).toBeVisible();

  await buscarEnElPadron(page, 'Gomez');
  await page.getByRole('button', { name: /Gomez Iriarte/ }).click();

  await expect(page.getByText('Gomez Iriarte, Luis Alberto')).toBeVisible();
}

test.describe('Reserva de turno', () => {
  let api: ApiDeTurnos;

  test.beforeEach(async ({ page }) => {
    api = await instalarApiDeTurnos(page);
  });

  /**
   * Escenario 1 — el camino feliz completo, desde el buscador y hasta el turno confirmado.
   *
   * <p>Pasa por las dos pantallas, la navegacion con el slot en la query, la relectura del dia,
   * la busqueda de persona, la reserva y la confirmacion. Es el unico test de la suite que no
   * empieza en una URL directa: si el buscador dejara de armar bien la query, este se cae.
   */
  test('buscar, elegir un slot, elegir la persona, reservar y confirmar', async ({ page }) => {
    await page.goto('/agenda');
    await page.getByLabel('Oferta', { exact: true }).selectOption({ label: NOMBRE_OFERTA });

    await page.getByRole('button', { name: /09:00 a 09:45/ }).click();

    // El slot viaja en la URL y no en el estado de navegacion: sobrevive a un refresh.
    await expect(page).toHaveURL(/\/agenda\/ofertas\/\d+\/reservar\?/);

    // El resumen se arma releyendo el dia, no con datos arrastrados: de ahi salen la zona y la
    // duracion, que son de la respuesta y no del cliente.
    await expect(page.getByText('09:00 a 09:45')).toBeVisible();
    await expect(page.getByText('45 min · zona America/Argentina/Buenos_Aires')).toBeVisible();
    await expect(page.getByText(NOMBRE_PROFESIONAL)).toBeVisible();

    await buscarEnElPadron(page, 'Gomez');
    await page.getByRole('button', { name: /Gomez Iriarte/ }).click();

    await page.getByRole('button', { name: 'Reservar el turno' }).click();

    await expect(page.getByRole('heading', { name: 'Turno RESERVADO', level: 2 })).toBeVisible();
    // Reservado no es confirmado, y la pantalla lo dice: son estados de la reserva.
    await expect(page.getByText('Todavia falta confirmarlo')).toBeVisible();

    await page.getByRole('button', { name: 'Confirmar el turno' }).click();

    await expect(page.getByRole('heading', { name: 'Turno CONFIRMADO', level: 2 })).toBeVisible();
    await expect(page.getByText('Turno confirmado.')).toBeVisible();

    // El dia se lee de la consulta que la pantalla hizo, no del campo: el buscador arranca en HOY
    // y leer el input antes de que la pantalla se asiente devuelve una cadena vacia.
    const diaDeLaGrilla = api.ventanasPedidas[0].desde;
    expect(diaDeLaGrilla).not.toBe('');

    expect(api.reservasRecibidas).toHaveLength(1);
    expect(api.reservasRecibidas[0].inicio).toBe(instante(diaDeLaGrilla, '09:00'));
    expect(api.reservasRecibidas[0].personaId).toBe(PERSONA_CON_PERFIL.id);
    expect(api.confirmaciones).toEqual([5001]);
  });

  // -----------------------------------------------------------------------------------------
  // Escenario 3 — los cuatro conflictos, cuatro acciones distintas
  // -----------------------------------------------------------------------------------------

  test('slot-no-disponible ofrece recargar la agenda, y recargar vuelve a pedirla', async ({
    page,
  }) => {
    api.reservar = () =>
      problema(409, 'slot-no-disponible', 'Ese horario ya no esta disponible.', {
        motivo: 'el profesional dejo de tener horario cargado',
      });

    await llegarConPersonaElegida(page);
    await page.getByRole('button', { name: 'Reservar el turno' }).click();

    await expect(page.getByRole('heading', { name: 'No se pudo reservar' })).toBeVisible();
    await soloSeOfrece(page, 'recargar');

    // El `motivo` de la extension se muestra: sin el, "dejo de estar disponible" no dice que paso.
    await expect(
      page.getByText('Lo que cambio: el profesional dejo de tener horario cargado'),
    ).toBeVisible();

    // Y el boton hace lo que promete: vuelve a pedir la agenda del dia.
    const consultas = api.ventanasPedidas.length;
    await page.getByRole('button', { name: 'Recargar la agenda' }).click();
    await expect(page.getByRole('heading', { name: 'No se pudo reservar' })).toHaveCount(0);
    await expect
      .poll(() => api.ventanasPedidas.length, { message: 'recargar tiene que releer el dia' })
      .toBeGreaterThan(consultas);
  });

  test('slot-completo ofrece el turno siguiente, y tomarlo corre el intento a ese horario', async ({
    page,
  }) => {
    api.reservar = () =>
      problema(409, 'slot-completo', 'Ese horario ya no tiene cupo.', { cupoTotal: 3 });

    await llegarConPersonaElegida(page);
    await page.getByRole('button', { name: 'Reservar el turno' }).click();

    await soloSeOfrece(page, 'siguiente');

    // `cupoTotal` viaja para poder decir cuantas admitia, no solo que se lleno.
    await expect(
      page.getByText('Ese horario admite 3 reservas y ya no queda ninguna.'),
    ).toBeVisible();
    // Recargar mostraria el mismo horario lleno: por eso este conflicto NO ofrece recargar.
    await expect(page.getByRole('button', { name: 'Tomar el siguiente: 09:45' })).toBeVisible();

    await page.getByRole('button', { name: 'Tomar el siguiente: 09:45' }).click();

    // El intento se corrio: el resumen ya es el del slot siguiente y el conflicto desaparecio.
    await expect(page.getByRole('heading', { name: 'No se pudo reservar' })).toHaveCount(0);
    await expect(page.getByText('09:45 a 10:30')).toBeVisible();

    // Y ese es el instante que sale en el proximo intento, no el del slot que estaba lleno.
    api.reservar = (cuerpo) => creado(turno(cuerpo.inicio, 'RESERVADO'));
    await page.getByRole('button', { name: 'Reservar el turno' }).click();
    await expect(page.getByRole('heading', { name: 'Turno RESERVADO' })).toBeVisible();
    expect(api.reservasRecibidas.at(-1)?.inicio).toBe(instante(FECHA, '09:45'));
  });

  test('recurso-ocupado manda a elegir otro horario o profesional, y nombra el recurso', async ({
    page,
  }) => {
    api.reservar = () =>
      problema(409, 'recurso-ocupado', 'Ya hay otro turno que se cruza.', {
        recurso: 'profesional',
      });

    await llegarConPersonaElegida(page);
    await page.getByRole('button', { name: 'Reservar el turno' }).click();

    await soloSeOfrece(page, 'otro');

    // Cual de los dos recursos esta ocupado cambia lo que el operador hace: si es el espacio, no
    // sirve cambiar de profesional.
    await expect(page.getByText('El recurso ocupado es el')).toBeVisible();
    await expect(page.getByText('profesional', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Elegir otro horario o profesional' }).click();
    await expect(page).toHaveURL(/\/agenda$/);
  });

  test('persona-sin-perfil-paciente manda al padron a activar el perfil', async ({ page }) => {
    api.reservar = () =>
      problema(
        409,
        'persona-sin-perfil-paciente',
        'Esa persona todavia no tiene perfil de paciente.',
      );

    await llegarConPersonaElegida(page);
    await page.getByRole('button', { name: 'Reservar el turno' }).click();

    await soloSeOfrece(page, 'perfil');

    // No es un error de agenda, y por eso no se resuelve en la agenda.
    await page.getByRole('link', { name: 'Activar el perfil de paciente' }).click();
    await expect(page).toHaveURL(/\/pacientes/);
  });

  // -----------------------------------------------------------------------------------------
  // Escenario 4 — la clave de idempotencia
  // -----------------------------------------------------------------------------------------

  /**
   * El doble click no crea dos turnos.
   *
   * <p>La primera respuesta se retiene en vuelo para que el segundo click ocurra <b>mientras la
   * primera todavia viaja</b>, que es el momento en el que un doble turno seria posible. El
   * servidor simulado se comporta como el real: la misma clave devuelve <b>el mismo turno</b>, y
   * una clave distinta devolveria otro id — que es lo que haria fallar a este test si la pantalla
   * regenerara la clave dentro del mismo intento.
   */
  test('el doble click no crea dos turnos: el reintento manda la misma clave', async ({ page }) => {
    const emitidos = new Map<string, unknown>();
    let soltar = (): void => {};
    const enVuelo = new Promise<void>((resolver) => {
      soltar = resolver;
    });

    api.reservar = async (cuerpo, intento) => {
      if (intento === 1) {
        await enVuelo;
      }
      const yaEmitido = emitidos.get(cuerpo.idempotencyKey);
      if (yaEmitido !== undefined) {
        return ok(yaEmitido);
      }
      const nuevo = turno(cuerpo.inicio, 'RESERVADO', 5000 + emitidos.size + 1);
      emitidos.set(cuerpo.idempotencyKey, nuevo);
      return creado(nuevo);
    };

    await llegarConPersonaElegida(page);
    await page.getByRole('button', { name: 'Reservar el turno' }).dblclick();
    soltar();

    await expect(page.getByRole('heading', { name: 'Turno RESERVADO', level: 2 })).toBeVisible();

    // Un solo turno en pantalla, y es el primero: 5001 y no 5002.
    await expect(page.getByRole('heading', { name: /^Turno /, level: 2 })).toHaveCount(1);
    await expect(page.getByText('5001', { exact: true })).toBeVisible();

    // Y todos los POST que hayan salido llevan LA MISMA clave: es lo que hace que el segundo no
    // cree nada. Si la pantalla generara una clave por click, el servidor emitiria un 5002.
    const claves = new Set(api.reservasRecibidas.map((r) => r.idempotencyKey));
    expect(claves.size, `salieron claves distintas: ${[...claves].join(', ')}`).toBe(1);
    expect(emitidos.size, 'el servidor no puede haber emitido dos turnos').toBe(1);
  });

  /**
   * El otro lado de la misma moneda: cuando el backend dice que la clave ya se uso para un pedido
   * distinto, reintentar con la misma volveria a fallar seguro. La pantalla la quema y arranca el
   * intento de cero.
   */
  test('tras idempotency-key-conflict, el reintento sale con una clave nueva', async ({ page }) => {
    api.reservar = (cuerpo, intento) =>
      intento === 1
        ? problema(409, 'idempotency-key-conflict', 'Esa clave ya se uso para otro pedido.')
        : creado(turno(cuerpo.inicio, 'RESERVADO'));

    await llegarConPersonaElegida(page);
    await page.getByRole('button', { name: 'Reservar el turno' }).click();

    await expect(page.getByText('no es un error tuyo')).toBeVisible();
    await page.getByRole('button', { name: 'Volver a intentar la reserva' }).click();

    await expect(page.getByRole('heading', { name: 'Turno RESERVADO', level: 2 })).toBeVisible();

    expect(api.reservasRecibidas).toHaveLength(2);
    expect(
      api.reservasRecibidas[1].idempotencyKey,
      'reintentar con la misma clave volveria a dar 409',
    ).not.toBe(api.reservasRecibidas[0].idempotencyKey);
  });
});
