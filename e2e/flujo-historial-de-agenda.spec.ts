import { Page, expect, test } from '@playwright/test';

import { navegar } from './support/agenda-real';
import { ZONA_DE_HOY } from './support/centro-de-hoy';
import {
  HistoriaSembrada,
  entrarComoAdministradora,
  entrarConContexto,
  sembrarHistoria,
} from './support/historia-clinica';
import { ApiAkine, fechaLocal } from './support/sembrado';

/**
 * Historial de cambios de la agenda, contra el backend real (contrato 0.155.0,
 * `GET /organizations/{orgId}/agenda/historial`).
 *
 * <p>Lo que verifica: que la profesional vea solo su agenda —sin selector, y con un 403 de alcance
 * propio si pide otra—, y que la administradora elija a la profesional, pagine de a 10, filtre por
 * tipo y ordene por fecha. Los cambios se siembran por la API: el horario semanal (siete altas),
 * una reserva, su confirmacion, una reprogramacion y un cierre: once cambios, dos paginas.
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
