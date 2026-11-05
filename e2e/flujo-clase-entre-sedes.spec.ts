import { randomUUID } from 'node:crypto';

import { Page, request as fabricaDeRequest, expect, test } from '@playwright/test';

import { ingresarPorPantalla, nonce } from './support/akine';
import { navegar } from './support/agenda-real';
import {
  API,
  ApiAkine,
  Centro,
  altaDeCentro,
  crearOferta,
  crearPersona,
  fechaLocal,
  ingresarComoPlataforma,
  sumarDias,
  uriDeProblema,
} from './support/sembrado';
import { plataformaDisponible } from './support/sembrado-configuracion';

/**
 * Turnos, clases y disponibilidad de la MISMA persona en dos sedes de la organizacion, contra el
 * backend real (contratos 0.156.0 y 0.158.0).
 *
 * <p>La profesional atiende turnos en la sede Centro (todo el dia, todos los dias) y da una clase en
 * la sede Norte. Desde 0.158.0 la disponibilidad es central por persona: para dar la clase en Norte
 * hay que abrirle esa franja alla, y como en Centro ya la ofrece, la apertura pide la sustitucion,
 * que cierra la franja en Centro. Lo que se afirma:
 *
 * <ol>
 *   <li>Una apertura en Norte superpuesta con el horario de Centro es 409 `bloque-solapado` que
 *       nombra a Centro; la pantalla de excepciones lo dice y ofrece cerrar la franja alla.</li>
 *   <li>La agenda de Centro no deja libre el horario de la clase de Norte, y reservarlo es 409 con
 *       la sede correcta, sin importar cual de los dos controles lo atrape primero.</li>
 *   <li>La carrera: mientras Centro reprograma un turno, Norte abre el horario elegido y pone una
 *       clase; confirmar dice con que choca y en que sede, nunca "en otra sede".</li>
 * </ol>
 *
 * <p>La segunda sede necesita un plan sin tope de sedes: lo da la plataforma, como en
 * `flujo-sedes.spec.ts`. La profesional suma un vinculo acotado a Norte con la misma cuenta.
 */
test.describe('Clases y turnos de la misma persona entre sedes', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  let centro: Centro;
  let norte: Centro;
  let nombreDeCentro: string;
  let nombreDeNorte: string;
  let api: ApiAkine;
  /** La administradora con el contexto en Norte: las rutas de una sede exigen esa sede. */
  let apiNorte: ApiAkine;
  let dia: string;
  let ofertaCentro: number;
  let ofertaGrupalNorte: number;
  let personaId: number;

  const enCentro = (sufijo: string): string =>
    `/api/v1/consultorios/${centro.consultorioId}${sufijo}`;
  const enNorte = (sufijo: string): string =>
    `/api/v1/consultorios/${norte.consultorioId}${sufijo}`;

  /** Instante UTC de una hora local de la sede (las dos comparten zona). */
  function instante(fecha: string, hora: string): string {
    const supuesto = new Date(`${fecha}T${hora}:00Z`);
    const enLaSede = new Date(supuesto.toLocaleString('en-US', { timeZone: centro.timezone }));
    const enUtc = new Date(supuesto.toLocaleString('en-US', { timeZone: 'UTC' }));
    return new Date(supuesto.getTime() - (enLaSede.getTime() - enUtc.getTime())).toISOString();
  }

  /** `HH:mm` local de la sede de un instante UTC. */
  function horaLocal(valor: string): string {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: centro.timezone,
    }).format(new Date(valor));
  }

  /** `YYYY-MM-DD` local de la sede de un instante UTC. */
  function fechaDe(valor: string): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: centro.timezone }).format(new Date(valor));
  }

  /** Apertura de la profesional en Norte para un dia (`fechaHasta` es exclusiva). */
  function abrirEnNorte(fecha: string, desde: string, hasta: string, sustituir: boolean) {
    return apiNorte.pedir('POST', enNorte('/excepciones'), {
      membershipId: norte.profesional.membershipId,
      tipo: 'APERTURA',
      motivo: 'AMPLIACION',
      fechaDesde: fecha,
      fechaHasta: sumarDias(fecha, 1),
      horaDesde: desde,
      horaHasta: hasta,
      notes: 'Clase en Norte de la profesional de Centro (E2E entre sedes)',
      ...(sustituir ? { sustituirDisponibilidadSuperpuesta: true } : {}),
    });
  }

  function claseEnNorte(inicio: string, fin: string): Promise<{ id: number }> {
    return apiNorte.exigir('POST', enNorte(`/clases/ofertas/${ofertaGrupalNorte}`), {
      titulo: `Pilates entre sedes ${nonce()}`,
      capacidad: 4,
      profesionalId: norte.profesional.membershipId,
      inicio,
      fin,
      idempotencyKey: randomUUID(),
    });
  }

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    // Sin el admin de plataforma sembrado no hay segunda sede (plan BASICO): como `flujo-sedes`.
    const motivo = await plataformaDisponible();
    test.skip(motivo !== null, motivo ?? '');
    centro = await altaDeCentro('entresedes', 'Entre Sedes');
    api = await ApiAkine.como(centro.emailAdmin, { organizationId: centro.organizationId });

    // --- Plan sin tope de sedes, y la sede Norte ---------------------------------------------
    const { version } = await api.exigir<{ version?: number }>(
      'GET',
      `/api/v1/organizations/${centro.organizationId}/subscription`,
    );
    const http = await fabricaDeRequest.newContext({ baseURL: API });
    try {
      const token = await ingresarComoPlataforma(http);
      const cambio = await http.post(
        `/api/v1/organizations/${centro.organizationId}/subscription/plan-changes`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json, application/problem+json',
          },
          data: { planCode: 'PROFESIONAL', expectedVersion: version ?? 0 },
        },
      );
      expect(cambio.status(), await cambio.text()).toBe(200);
    } finally {
      await http.dispose();
    }

    nombreDeNorte = `Sede Norte ${nonce()}`;
    const alta = await api.pedir(
      'POST',
      `/api/v1/organizations/${centro.organizationId}/consultorios`,
      { name: nombreDeNorte, timezone: centro.timezone },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(alta.status(), await alta.text()).toBe(201);
    const sedeNorte = (await alta.json()) as { id: number };
    const delCentro = await api.exigir<{ name: string }>(
      'GET',
      `/api/v1/organizations/${centro.organizationId}/consultorios/${centro.consultorioId}`,
    );
    nombreDeCentro = delCentro.name;

    // --- La misma profesional, tambien en Norte ----------------------------------------------
    const { membershipId } = await api.exigir<{ membershipId: number }>(
      'POST',
      '/api/v1/memberships',
      {
        email: centro.emailProfesional,
        roleCode: 'PROFESIONAL',
        consultorioId: sedeNorte.id,
        reason: 'La misma profesional en la segunda sede (E2E entre sedes)',
      },
    );
    norte = {
      ...centro,
      consultorioId: sedeNorte.id,
      profesional: { ...centro.profesional, membershipId },
    };
    apiNorte = await ApiAkine.como(centro.emailAdmin, {
      organizationId: centro.organizationId,
      consultorioId: sedeNorte.id,
    });

    ofertaCentro = (await crearOferta(api, centro)).id;
    ofertaGrupalNorte = (
      await crearOferta(apiNorte, norte, {
        nombre: `Pilates Norte ${nonce()}`,
        extra: { modalidad: 'GRUPAL', capacidad: 8 },
      })
    ).id;
    personaId = (await crearPersona(api, { conPerfil: true })).id;

    // La clase exige disponibilidad en Norte (0.158.0). En Centro atiende todo el dia, asi que la
    // apertura de la franja de la clase pide la sustitucion: cierra esa franja en Centro.
    dia = fechaLocal(centro.timezone, 5);
    const apertura = await abrirEnNorte(dia, '10:00', '11:00', true);
    expect(apertura.status(), await apertura.text()).toBeLessThan(300);
    await claseEnNorte(instante(dia, '10:00'), instante(dia, '11:00'));
  });

  test.afterAll(async () => {
    await api?.cerrar();
    await apiNorte?.cerrar();
  });

  test('una apertura en Norte sobre el horario de Centro es 409 y nombra a Centro (0.158.0)', async () => {
    const otroDia = fechaLocal(centro.timezone, 6);
    const rechazo = await abrirEnNorte(otroDia, '16:00', '17:00', false);
    expect(rechazo.status(), await rechazo.text()).toBe(409);
    const problema = (await rechazo.json()) as Record<string, unknown>;
    expect(problema['type']).toBe(uriDeProblema('bloque-solapado'));
    expect(problema['conflictoMismaSede']).toBe(false);
    expect(problema['conflictoConsultorioNombre']).toBe(nombreDeCentro);
    expect(problema['detail']).toContain(nombreDeCentro);
    expect((problema['superposiciones'] as unknown[]).length).toBeGreaterThan(0);
  });

  test('Centro no ofrece la hora de la clase de Norte, y el 409 nombra la sede correcta', async () => {
    // `hasta` es exclusivo: la ventana del dia es [dia, dia + 1).
    const agenda = await api.exigir<{
      ocupacionesEnOtrasSedes?: { membershipId: number; tipo: string; consultorioId: number }[];
    }>('GET', enCentro(`/agenda/operativa?desde=${dia}&hasta=${fechaLocal(centro.timezone, 6)}`));
    expect(agenda.ocupacionesEnOtrasSedes).toContainEqual(
      expect.objectContaining({
        membershipId: centro.profesional.membershipId,
        tipo: 'CLASE',
        consultorioId: norte.consultorioId,
      }),
    );

    const reserva = {
      inicio: instante(dia, '10:00'),
      personaId,
      profesionalId: centro.profesional.membershipId,
    };
    const rechazo = await api.pedir('POST', enCentro(`/turnos/ofertas/${ofertaCentro}`), {
      ...reserva,
      idempotencyKey: randomUUID(),
    });
    expect(rechazo.status(), await rechazo.text()).toBe(409);
    const problema = (await rechazo.json()) as Record<string, unknown>;
    // Dos controles lo atrapan: la franja cerrada en Centro por la sustitucion, o la clase de Norte.
    // Cualquiera que gane, la sede que se nombra es la del conflicto, no "otra sede".
    if (problema['type'] === uriDeProblema('recurso-ocupado')) {
      expect(problema['conflictoTipo']).toBe('CLASE');
      expect(problema['conflictoConsultorioNombre']).toBe(nombreDeNorte);
      expect(problema['conflictoMismaSede']).toBe(false);
    } else {
      expect(problema['type']).toBe(uriDeProblema('slot-no-disponible'));
      expect(problema['conflictoConsultorioNombre']).toBe(nombreDeCentro);
      expect(problema['conflictoMismaSede']).toBe(true);
    }
    expect(String(problema['detail'])).not.toContain('otra sede');

    const sobreturno = await api.pedir('POST', enCentro(`/turnos/ofertas/${ofertaCentro}`), {
      ...reserva,
      sobreturnoMotivo: 'Urgencia (E2E)',
      idempotencyKey: randomUUID(),
    });
    expect(sobreturno.status(), 'una clase no se pisa con un sobreturno').toBe(409);
  });

  test('la grilla de Centro muestra "Ocupado en otra sede" sin datos de la clase', async ({
    page,
  }) => {
    await entrarEn(page, nombreDeCentro);
    await navegar(page, `/agenda?fecha=${dia}`);

    const fuera = page.locator('.evento--fuera');
    await expect(fuera.first()).toBeVisible();
    await expect(fuera.first()).toContainText('Ocupado en otra sede');
    await expect(fuera.first()).toContainText('Clase');
    await expect(fuera.first()).not.toContainText('Pilates');
  });

  test('carrera: Norte abre el horario elegido y pone una clase mientras Centro reprograma', async ({
    page,
  }) => {
    const turno = await api.exigir<{ id: number }>(
      'POST',
      enCentro(`/turnos/ofertas/${ofertaCentro}`),
      {
        inicio: instante(dia, '15:00'),
        personaId,
        profesionalId: centro.profesional.membershipId,
        idempotencyKey: randomUUID(),
      },
    );

    await entrarEn(page, nombreDeCentro);
    await navegar(page, `/agenda?fecha=${dia}`);
    await page.getByRole('button', { name: /^15:00 a / }).click();
    const dialogo = page.getByRole('dialog');
    const busqueda = page.waitForResponse(
      (r) => r.url().includes('/disponibilidad/busqueda') && r.request().method() === 'POST',
    );
    await dialogo.getByText('Más acciones').click();
    await dialogo.getByRole('button', { name: 'Reprogramar' }).click();
    const { horarios } = (await (await busqueda).json()) as {
      horarios: { desde: string; hasta: string }[];
    };
    expect(horarios.length).toBeGreaterThan(0);

    // Otra recepcion, en Norte, abre ese horario (cerrandolo en Centro) y programa una clase.
    const elegido = horarios[0];
    const apertura = await abrirEnNorte(
      fechaDe(elegido.desde),
      horaLocal(elegido.desde),
      horaLocal(elegido.hasta),
      true,
    );
    expect(apertura.status(), await apertura.text()).toBeLessThan(300);
    await claseEnNorte(elegido.desde, elegido.hasta);

    await dialogo.locator('.horario').first().click();
    const respuesta = page.waitForResponse(
      (r) => /\/turnos\/\d+\/reprogramacion$/.test(r.url()) && r.request().method() === 'POST',
    );
    await dialogo.getByRole('button', { name: 'Reprogramar' }).click();
    expect((await respuesta).status()).toBe(409);
    // La causa y la sede reales: el cierre en Centro, o la clase en Norte.
    await expect(
      dialogo.getByText(
        new RegExp(`en la sede (${escapar(nombreDeCentro)}|${escapar(nombreDeNorte)})`),
      ),
    ).toBeVisible();
    await expect(dialogo).not.toContainText('otra sede');

    const leido = await api.exigir<{ inicio: string }>('GET', enCentro(`/turnos/${turno.id}`));
    expect(new Date(leido.inicio).getTime()).toBe(new Date(instante(dia, '15:00')).getTime());
  });

  test('la pantalla de excepciones de Norte nombra a Centro y sustituye solo con un click', async ({
    page,
  }) => {
    const otroDia = fechaLocal(centro.timezone, 8);
    await entrarEn(page, nombreDeNorte);
    await navegar(page, '/horarios/excepciones');
    await page.getByRole('button', { name: 'Cargar un cierre o una apertura' }).click();
    await page.getByLabel('Que se carga').selectOption('APERTURA');
    await page.getByLabel('Motivo').selectOption('AMPLIACION');
    await page.getByLabel('A quien alcanza').selectOption(String(norte.profesional.membershipId));
    await page.getByLabel('Primer día').fill(otroDia);
    await page.getByLabel('Fin (exclusivo)').fill(sumarDias(otroDia, 1));
    await page.getByLabel('Día completo').uncheck();
    await page.getByLabel('Desde (HH:MM)').fill('16:00');
    await page.getByLabel('Hasta (HH:MM, exclusiva)').fill('17:00');

    const primera = page.waitForResponse(
      (r) => /\/excepciones$/.test(r.url()) && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Cargar la excepción' }).click();
    expect((await primera).status()).toBe(409);

    const alerta = page.getByRole('alert').filter({ hasText: 'No pudimos cargar la excepción' });
    await expect(alerta).toContainText(nombreDeCentro);
    await expect(alerta).not.toContainText('otra sede');
    const sustituir = page.getByRole('button', {
      name: `Cerrar esa franja en ${nombreDeCentro} y abrir acá`,
    });
    await expect(sustituir).toBeVisible();

    const segunda = page.waitForResponse(
      (r) => /\/excepciones$/.test(r.url()) && r.request().method() === 'POST',
    );
    await sustituir.click();
    const respuesta = await segunda;
    expect(respuesta.request().postDataJSON()).toEqual(
      expect.objectContaining({ sustituirDisponibilidadSuperpuesta: true }),
    );
    expect(respuesta.status()).toBeLessThan(300);
    const avisos = page.getByRole('region', { name: 'Notificaciones', exact: true });
    await expect(avisos.getByText('Apertura cargada')).toBeVisible();

    // En Centro quedo el cierre de esa franja, a nombre de la misma profesional.
    const cierres = await api.exigir<{ tipo?: string; membershipId?: number }[]>(
      'GET',
      // Sin `membershipId` el listado trae solo las excepciones de la sede, no las de cada persona.
      enCentro(
        `/excepciones?desde=${otroDia}&hasta=${sumarDias(otroDia, 1)}&membershipId=${centro.profesional.membershipId}`,
      ),
    );
    expect(cierres).toContainEqual(
      expect.objectContaining({ tipo: 'CIERRE', membershipId: centro.profesional.membershipId }),
    );
  });

  /**
   * Con dos sedes el selector pregunta: se elige la sede por su nombre, anclado al principio porque
   * la opcion de Norte tambien nombra a la organizacion (que se llama como la sede del alta).
   */
  async function entrarEn(page: Page, sede: string): Promise<void> {
    await ingresarPorPantalla(page, centro.emailAdmin);
    await expect(page).toHaveURL(/\/seleccionar-contexto/, { timeout: 45_000 });
    await page.getByRole('button', { name: new RegExp(`^${escapar(sede)}`) }).click();
    await expect(page).not.toHaveURL(/\/(auth|seleccionar-contexto)/, { timeout: 45_000 });
  }
});

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
