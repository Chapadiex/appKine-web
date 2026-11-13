import { randomUUID } from 'node:crypto';

import { Page, request as fabricaDeRequest, expect, test } from '@playwright/test';

import { ingresarPorPantalla, nonce } from './support/akine';
import { navegar } from './support/agenda-real';
import { ZONA_DE_HOY } from './support/centro-de-hoy';
import {
  HistoriaSembrada,
  entrarComoAdministradora,
  entrarConContexto,
  sembrarHistoria,
} from './support/historia-clinica';
import {
  API,
  ApiAkine,
  Centro,
  altaDeCentro,
  crearOferta,
  crearPersona,
  fechaLocal,
  ingresarComoPlataforma,
  reservar,
} from './support/sembrado';
import { plataformaDisponible } from './support/sembrado-configuracion';

/**
 * Historial de cambios de la agenda, contra el backend real (contrato 0.157.0,
 * `GET /organizations/{orgId}/agenda/historial`).
 *
 * <p>Lo que verifica: que la profesional vea solo su agenda —sin selector, y con un 403 de alcance
 * propio si pide otra—, y que la administradora elija a la profesional, pagine de a 10, filtre por
 * tipo y ordene por fecha. Los cambios se siembran por la API: el horario semanal (siete altas),
 * una reserva, su confirmacion, una reprogramacion y un cierre: once cambios, dos paginas.
 *
 * <p>Desde 0.157.0, ademas: un cierre de la sede entera aparece en la agenda de la profesional que
 * tenia un turno en el periodo, con el enlace a la agenda en "a reubicar"; y un traslado de sede es
 * UNA fila, sin la cancelacion ni la reserva que lo componen.
 */
test.describe('Historial de cambios de la agenda', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 });

  const ZONA = ZONA_DE_HOY;
  const MOTIVO = 'Pedido del paciente (E2E historial)';

  let sembrada: HistoriaSembrada;
  let admin: ApiAkine;
  let profesional: ApiAkine;
  let membershipDeLaAdmin: number;

  const ruta = (sufijo: string): string =>
    `/api/v1/consultorios/${sembrada.consultorioId}${sufijo}`;
  const historial = (): string =>
    `/api/v1/organizations/${sembrada.organizationId}/agenda/historial`;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    sembrada = await sembrarHistoria(request);
    admin = await ApiAkine.como(sembrada.emailAdmin, { organizationId: sembrada.organizationId });
    profesional = await ApiAkine.como(sembrada.email, { organizationId: sembrada.organizationId });

    const rutaDeLaSede = `/api/v1/organizations/${sembrada.organizationId}/consultorios/${sembrada.consultorioId}`;
    const sede = await admin.exigir<{ version: number }>('GET', rutaDeLaSede);
    await admin.exigir('PATCH', rutaDeLaSede, { timezone: ZONA, version: sede.version });

    for (let diaSemana = 1; diaSemana <= 7; diaSemana++) {
      await admin.exigir('POST', ruta(`/profesionales/${sembrada.membershipId}/disponibilidad`), {
        diaSemana,
        horaDesde: '08:00',
        horaHasta: '20:00',
      });
    }

    const dia = fechaLocal(ZONA, 4);
    const turno = await admin.exigir<{ id: number }>(
      'POST',
      ruta(`/turnos/ofertas/${sembrada.oferta.id}`),
      {
        inicio: instanteDeLaSede(dia, '10:00'),
        personaId: sembrada.personaId,
        profesionalId: sembrada.membershipId,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    await admin.exigir('POST', ruta(`/turnos/${turno.id}/confirmacion`));
    const leido = await admin.exigir<{ version: number }>('GET', ruta(`/turnos/${turno.id}`));
    await admin.exigir('POST', ruta(`/turnos/${turno.id}/reprogramacion`), {
      inicio: instanteDeLaSede(dia, '12:00'),
      profesionalId: sembrada.membershipId,
      motivo: MOTIVO,
      expectedVersion: leido.version,
    });

    const cierre = fechaLocal(ZONA, 10);
    await admin.exigir('POST', ruta('/excepciones'), {
      membershipId: sembrada.membershipId,
      tipo: 'CIERRE',
      motivo: 'LICENCIA',
      fechaDesde: cierre,
      fechaHasta: fechaLocal(ZONA, 11),
      notes: 'Licencia sintetica del E2E de historial',
    });

    const vinculos = await admin.exigir<{ content: { id: number; roleCode: string }[] }>(
      'GET',
      `/api/v1/organizations/${sembrada.organizationId}/memberships?size=100`,
    );
    membershipDeLaAdmin = vinculos.content.find((v) => v.roleCode === 'ORG_ADMIN')?.id ?? 0;
    expect(membershipDeLaAdmin).toBeGreaterThan(0);
  });

  test.afterAll(async () => {
    await admin?.cerrar();
    await profesional?.cerrar();
  });

  test('la profesional ve solo su agenda: sin selector, y otra agenda es 403 de alcance propio', async ({
    page,
  }) => {
    await entrarConContexto(page, sembrada);
    await navegar(page, '/horarios/cambios');

    await expect(page.getByRole('heading', { name: 'Cambios de la agenda' })).toBeVisible();
    await expect(page.getByLabel('Profesional', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Tu agenda')).toBeVisible();
    const tabla = page.getByRole('region', { name: 'Cambios de la agenda' });
    await expect(tabla.getByRole('cell', { name: /^Se movió un turno de horario/ })).toBeVisible();
    await expect(tabla.getByText(MOTIVO)).toBeVisible();

    const ajena = await profesional.pedir(
      'GET',
      `${historial()}?profesionalId=${membershipDeLaAdmin}`,
    );
    expect(ajena.status()).toBe(403);
    expect(((await ajena.json()) as { alcance?: string }).alcance).toBe('PROPIO');
  });

  test('la administradora elige, pagina de a 10, filtra por tipo y ordena', async ({ page }) => {
    await entrarComoAdministradora(page, sembrada);
    await navegar(page, '/horarios/cambios');

    await expect(
      page.getByText('Elegí un profesional para ver los cambios de su agenda.'),
    ).toBeVisible();
    const pedido = esperarHistorial(page);
    await page
      .getByLabel('Profesional', { exact: true })
      .selectOption(String(sembrada.membershipId));
    const primera = await pedido;
    expect(new URL(primera.url()).searchParams.get('size')).toBe('10');
    const total = ((await primera.json()) as { totalElements: number }).totalElements;
    expect(total).toBeGreaterThanOrEqual(11);

    const filas = page.getByRole('region', { name: 'Cambios de la agenda' }).locator('tbody tr');
    await expect(filas).toHaveCount(10);
    await expect(page.getByText(`${total} cambios`)).toBeVisible();
    // Del mas nuevo al mas viejo: arriba el cierre, el ultimo cambio sembrado.
    await expect(filas.first()).toContainText('Se cargó un cierre o apertura');

    // Orden ascendente: arriba el primer alta del horario.
    const ordenado = esperarHistorial(page);
    await page.getByRole('button', { name: /Cuándo/ }).click();
    expect(new URL((await ordenado).url()).searchParams.get('sort')).toBe('ocurridoEn,asc');
    await expect(filas.first()).toContainText('Se agregó un horario');

    // Solo los turnos: reserva, confirmacion y reprogramacion.
    await page.getByRole('button', { name: 'Filtros' }).click();
    await page.getByRole('checkbox', { name: 'Turnos' }).check();
    const filtrado = esperarHistorial(page);
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();
    expect(new URL((await filtrado).url()).searchParams.getAll('tipo')).toContain(
      'TURNO_REPROGRAMACION',
    );
    await expect(filas).toHaveCount(3);
    await expect(filas.filter({ hasText: 'Se movió un turno de horario' })).toContainText(MOTIVO);
  });

  /** Instante UTC de una hora local de la sede. */
  function instanteDeLaSede(fecha: string, hora: string): string {
    const supuesto = new Date(`${fecha}T${hora}:00Z`);
    const enLaSede = new Date(supuesto.toLocaleString('en-US', { timeZone: ZONA }));
    const enUtc = new Date(supuesto.toLocaleString('en-US', { timeZone: 'UTC' }));
    return new Date(supuesto.getTime() - (enLaSede.getTime() - enUtc.getTime()))
      .toISOString()
      .replace('.000', '');
  }

  function esperarHistorial(page: Page) {
    return page.waitForResponse(
      (r) => r.url().includes('/agenda/historial') && r.request().method() === 'GET',
    );
  }
});

/** Instante UTC (sin milisegundos) de una hora local en `zona`. */
function instanteEn(zona: string, fecha: string, hora: string): string {
  const supuesto = new Date(`${fecha}T${hora}:00Z`);
  const enLaSede = new Date(supuesto.toLocaleString('en-US', { timeZone: zona }));
  const enUtc = new Date(supuesto.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(supuesto.getTime() - (enLaSede.getTime() - enUtc.getTime()))
    .toISOString()
    .replace('.000', '');
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Ingresa por pantalla; si el selector de contexto pregunta, elige la sede por su nombre. */
async function entrarEn(page: Page, email: string, sede: string): Promise<void> {
  await ingresarPorPantalla(page, email);
  await page.waitForURL((url) => !/\/auth\/ingresar/.test(url.pathname), { timeout: 45_000 });
  if (/\/seleccionar-contexto/.test(page.url())) {
    await page.getByRole('button', { name: new RegExp(`^${escapar(sede)}`) }).click();
  }
  await expect(page).not.toHaveURL(/\/(auth|seleccionar-contexto)/, { timeout: 45_000 });
}

test.describe('Historial de agenda: cierre general de sede', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 });

  let centro: Centro;
  let admin: ApiAkine;
  let dia: string;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    centro = await altaDeCentro('histcierre', 'Historial Cierre');
    admin = await ApiAkine.como(centro.emailAdmin, { organizationId: centro.organizationId });
    const oferta = await crearOferta(admin, centro);
    const persona = await crearPersona(admin, { conPerfil: true });

    // Un turno de la profesional dentro del cierre: el cierre la toca y le deja uno a reubicar.
    dia = fechaLocal(centro.timezone, 6);
    await reservar(admin, centro, oferta.id, persona.id, instanteEn(centro.timezone, dia, '10:00'));

    // Sin `membershipId`: la sede entera. Lo carga la administradora, no la profesional.
    await admin.exigir('POST', `/api/v1/consultorios/${centro.consultorioId}/excepciones`, {
      tipo: 'CIERRE',
      motivo: 'FERIADO',
      fechaDesde: dia,
      fechaHasta: fechaLocal(centro.timezone, 7),
      confirmaTurnosAfectados: true,
      notes: 'Cierre de sede sintetico del E2E de historial',
    });
  });

  test.afterAll(async () => {
    await admin?.cerrar();
  });

  test('la profesional afectada lo ve en su agenda y llega a la agenda en a reubicar', async ({
    page,
  }) => {
    await entrarEn(page, centro.emailProfesional, centro.nombreCentro);
    await navegar(page, '/horarios/cambios');

    const tabla = page.getByRole('region', { name: 'Cambios de la agenda' });
    const fila = tabla.locator('tbody tr').filter({ hasText: 'Cierre general de sede' });
    await expect(fila).toHaveCount(1);
    await expect(fila).toContainText('día completo');
    await expect(fila).toContainText('Vigente');
    await expect(fila).toContainText('Feriado');
    await expect(fila).toContainText('1 turno en el período · 1 a reubicar');

    await fila.getByRole('link', { name: 'Reubicar turnos' }).click();
    await expect(page).toHaveURL(/\/agenda\?/);
    const destino = new URL(page.url());
    expect(destino.searchParams.get('estado')).toBe('A_REUBICAR');
    expect(destino.searchParams.get('fecha')).toBe(dia);
  });
});

test.describe('Historial de agenda: traslado de sede en una fila', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 });

  const MOTIVO_TRASLADO = 'El paciente se mudo (E2E historial)';

  let centro: Centro;
  let admin: ApiAkine;
  let nombreDeCentro: string;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    // Sin el admin de plataforma sembrado no hay segunda sede (plan BASICO): como `flujo-sedes`.
    const motivo = await plataformaDisponible();
    test.skip(motivo !== null, motivo ?? '');
    centro = await altaDeCentro('histtraslado', 'Historial Traslado');
    admin = await ApiAkine.como(centro.emailAdmin, { organizationId: centro.organizationId });

    const { version } = await admin.exigir<{ version?: number }>(
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

    const alta = await admin.pedir(
      'POST',
      `/api/v1/organizations/${centro.organizationId}/consultorios`,
      { name: `Sede Norte ${nonce()}`, timezone: centro.timezone },
      { 'Idempotency-Key': randomUUID() },
    );
    expect(alta.status(), await alta.text()).toBe(201);
    const norte = (await alta.json()) as { id: number };
    nombreDeCentro = (
      await admin.exigir<{ name: string }>(
        'GET',
        `/api/v1/organizations/${centro.organizationId}/consultorios/${centro.consultorioId}`,
      )
    ).name;

    // La misma profesional en Norte, con una apertura puntual. Desde 0.158.0 la disponibilidad es
    // central por persona: como en Centro atiende todo el dia, la franja de Norte pide la sustitucion
    // (cierra esa franja en Centro). El turno de las 10:00 en Centro queda afuera de esa franja.
    const { membershipId } = await admin.exigir<{ membershipId: number }>(
      'POST',
      '/api/v1/memberships',
      {
        email: centro.emailProfesional,
        roleCode: 'PROFESIONAL',
        consultorioId: norte.id,
        reason: 'La misma profesional en la segunda sede (E2E historial)',
      },
    );
    const enNorte: Centro = {
      ...centro,
      consultorioId: norte.id,
      profesional: { ...centro.profesional, membershipId },
    };
    const apiNorte = await ApiAkine.como(centro.emailAdmin, {
      organizationId: centro.organizationId,
      consultorioId: norte.id,
    });
    try {
      const dia = fechaLocal(centro.timezone, 5);
      await apiNorte.exigir('POST', `/api/v1/consultorios/${norte.id}/excepciones`, {
        membershipId,
        tipo: 'APERTURA',
        motivo: 'AMPLIACION',
        fechaDesde: dia,
        fechaHasta: fechaLocal(centro.timezone, 6),
        horaDesde: '14:00',
        horaHasta: '16:00',
        notes: 'Apertura en Norte (E2E historial)',
        sustituirDisponibilidadSuperpuesta: true,
      });
      const ofertaNorte = await crearOferta(apiNorte, enNorte);
      const ofertaCentro = await crearOferta(admin, centro);
      const persona = await crearPersona(admin, { conPerfil: true });

      const turno = await reservar(
        admin,
        centro,
        ofertaCentro.id,
        persona.id,
        instanteEn(centro.timezone, dia, '10:00'),
      );
      const leido = await admin.exigir<{ version: number }>(
        'GET',
        `/api/v1/consultorios/${centro.consultorioId}/turnos/${turno.id}`,
      );
      await admin.exigir(
        'POST',
        `/api/v1/consultorios/${centro.consultorioId}/turnos/${turno.id}/traslado`,
        {
          consultorioDestinoId: norte.id,
          ofertaId: ofertaNorte.id,
          profesionalId: membershipId,
          inicio: instanteEn(centro.timezone, dia, '15:00'),
          motivo: MOTIVO_TRASLADO,
          expectedVersion: leido.version,
        },
      );
    } finally {
      await apiNorte.cerrar();
    }
  });

  test.afterAll(async () => {
    await admin?.cerrar();
  });

  test('un traslado es una sola fila: sin la cancelación ni la reserva que lo componen', async ({
    page,
  }) => {
    await entrarEn(page, centro.emailAdmin, nombreDeCentro);
    await navegar(page, `/horarios/cambios?membershipId=${centro.profesional.membershipId}`);

    const filas = page.getByRole('region', { name: 'Cambios de la agenda' }).locator('tbody tr');
    const traslado = filas.filter({ hasText: 'Turno trasladado' });
    await expect(traslado).toHaveCount(1);
    await expect(traslado).toContainText(MOTIVO_TRASLADO);
    await expect(traslado).toContainText('→');
    await expect(filas.filter({ hasText: 'Se canceló un turno' })).toHaveCount(0);
    // La unica reserva es la del turno original; la de Norte va en el detalle tecnico.
    await expect(filas.filter({ hasText: 'Se reservó un turno' })).toHaveCount(1);

    await traslado.getByText('Detalle técnico').click();
    await expect(traslado).toContainText('Cancelación del turno original');
    await expect(traslado).toContainText('Reserva del turno en la sede de destino');
  });
});
