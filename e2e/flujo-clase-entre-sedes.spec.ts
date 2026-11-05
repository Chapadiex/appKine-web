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
  uriDeProblema,
} from './support/sembrado';
import { plataformaDisponible } from './support/sembrado-configuracion';

/**
 * Turnos y clases de la MISMA persona en dos sedes de la organizacion, contra el backend real
 * (contrato 0.156.0).
 *
 * <p>La profesional atiende turnos en la sede Centro y da una clase en la sede Norte. Lo que se
 * afirma:
 *
 * <ol>
 *   <li>La agenda de Centro no deja libre el horario de la clase de Norte: la API lo publica en
 *       `ocupacionesEnOtrasSedes` y la grilla lo dibuja como "Ocupado en otra sede", sin datos.</li>
 *   <li>Reservar ese horario en Centro es 409 `recurso-ocupado` con `conflictoTipo: CLASE` y la sede
 *       de Norte, y un sobreturno tampoco lo pisa.</li>
 *   <li>La carrera: mientras la pantalla de Centro reprograma un turno, Norte pone una clase en el
 *       horario elegido; confirmar dice que choca con una clase, en vez de un error generico.</li>
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

    const alta = await api.pedir(
      'POST',
      `/api/v1/organizations/${centro.organizationId}/consultorios`,
      { name: `Sede Norte ${nonce()}`, timezone: centro.timezone },
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
    // El horario habitual de una persona no puede pisarse entre sedes (api #189, `bloque-solapado`),
    // y en Centro atiende todo el dia. Para que dicte clases en Norte a cualquier hora se le abre
    // una APERTURA puntual, que no valida el cruce entre sedes. Cubre de hoy a 30 dias: la carrera
    // pone la clase en el primer horario que ofrece la reprogramacion, que puede no caer en `dia`.
    await apiNorte.exigir('POST', enNorte('/excepciones'), {
      membershipId,
      tipo: 'APERTURA',
      motivo: 'AMPLIACION',
      fechaDesde: fechaLocal(centro.timezone),
      fechaHasta: fechaLocal(centro.timezone, 30),
      horaDesde: '00:00',
      horaHasta: '23:45',
      notes: 'Clases en Norte de la profesional de Centro (E2E entre sedes)',
    });

    ofertaCentro = (await crearOferta(api, centro)).id;
    ofertaGrupalNorte = (
      await crearOferta(apiNorte, norte, {
        nombre: `Pilates Norte ${nonce()}`,
        extra: { modalidad: 'GRUPAL', capacidad: 8 },
      })
    ).id;
    personaId = (await crearPersona(api, { conPerfil: true })).id;

    dia = fechaLocal(centro.timezone, 5);
    await claseEnNorte(instante(dia, '10:00'), instante(dia, '11:00'));
  });

  test.afterAll(async () => {
    await api?.cerrar();
    await apiNorte?.cerrar();
  });

  test('Centro no ofrece la hora de la clase de Norte, ni con sobreturno', async () => {
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
    expect(problema['type']).toBe(uriDeProblema('recurso-ocupado'));
    expect(problema['conflictoTipo']).toBe('CLASE');
    expect(problema['conflictoConsultorioId']).toBe(norte.consultorioId);
    expect(problema['claseEnConflictoId']).toBeGreaterThan(0);

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
    await entrarEnCentro(page);
    await navegar(page, `/agenda?fecha=${dia}`);

    const fuera = page.locator('.evento--fuera');
    await expect(fuera.first()).toBeVisible();
    await expect(fuera.first()).toContainText('Ocupado en otra sede');
    await expect(fuera.first()).toContainText('Clase');
    await expect(fuera.first()).not.toContainText('Pilates');
  });

  test('carrera: Norte pone una clase en el horario elegido mientras Centro reprograma', async ({
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

    await entrarEnCentro(page);
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

    // Otra recepcion, en Norte, programa una clase justo en el primer horario ofrecido.
    await claseEnNorte(horarios[0].desde, horarios[0].hasta);

    await dialogo.locator('.horario').first().click();
    const respuesta = page.waitForResponse(
      (r) => /\/turnos\/\d+\/reprogramacion$/.test(r.url()) && r.request().method() === 'POST',
    );
    await dialogo.getByRole('button', { name: 'Reprogramar' }).click();
    expect((await respuesta).status()).toBe(409);
    await expect(dialogo.getByText(/tiene una clase que se cruza/)).toBeVisible();
    await expect(dialogo.getByText(/^Clase en /)).toBeVisible();

    const leido = await api.exigir<{ inicio: string }>('GET', enCentro(`/turnos/${turno.id}`));
    expect(new Date(leido.inicio).getTime()).toBe(new Date(instante(dia, '15:00')).getTime());
  });

  /**
   * Con dos sedes el selector pregunta: se elige Centro por su nombre, anclado al principio porque
   * la opcion de Norte tambien lo nombra (la organizacion se llama como la sede del alta).
   */
  async function entrarEnCentro(page: Page): Promise<void> {
    await ingresarPorPantalla(page, centro.emailAdmin);
    await expect(page).toHaveURL(/\/seleccionar-contexto/, { timeout: 45_000 });
    await page.getByRole('button', { name: new RegExp(`^${escapar(nombreDeCentro)}`) }).click();
    await expect(page).not.toHaveURL(/\/(auth|seleccionar-contexto)/, { timeout: 45_000 });
  }
});

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
