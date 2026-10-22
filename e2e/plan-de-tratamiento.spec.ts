import { expect, test } from '@playwright/test';

import { sql } from './support/akine';
import { navegar } from './support/agenda-real';
import {
  HistoriaSembrada,
  MOTIVO_DE_ACCESO,
  abrirHistoriaConMotivo,
  entrarConContexto,
  sembrarHistoria,
} from './support/historia-clinica';
import {
  ApiAkine,
  crearFinanciador,
  darCobertura,
  fechaLocal,
  practicaGlobal,
  sumarDias,
} from './support/sembrado';

/**
 * E2E del Plan de Tratamiento (D-c, RF-M11-001..006) contra el backend real.
 *
 * <p>El ciclo entero sobre un caso: crear el plan con el editor estructurado (oferta elegida de una
 * lista, cantidades planificadas y autorizadas), activarlo, ver el avance DERIVADO por el backend
 * —0 realizadas: nada se carga a mano— con el aviso de "planificadas mas que autorizadas",
 * modificarlo (version 2), mirar el avance de la versión 1, suspender, reanudar y finalizar.
 */
test.describe('Plan de tratamiento (D-c)', () => {
  test.describe.configure({ mode: 'default', timeout: 180_000 });

  let sembrada: HistoriaSembrada;
  let casoId: number;

  test.beforeAll(async ({ request }) => {
    // Dos altas por sembrado contra un limite de 5 por minuto: la espera de cupo puede ser larga.
    test.setTimeout(300_000);
    sembrada = await sembrarHistoria(request);
    const profesional = await ApiAkine.como(sembrada.email, {
      organizationId: sembrada.organizationId,
    });
    try {
      const caso = await profesional.pedir(
        'POST',
        `/api/v1/historias-clinicas/${sembrada.historiaClinicaId}/casos`,
        { ofertaId: sembrada.oferta.id, diagnosticoPresuntivo: 'Tendinopatia rotuliana sintetica' },
        { 'X-Justificacion-Acceso': MOTIVO_DE_ACCESO },
      );
      expect(caso.status(), await caso.text()).toBe(201);
      casoId = ((await caso.json()) as { id: number }).id;
    } finally {
      await profesional.cerrar();
    }
  });

  test('crear, activar, ver avance, versionar, suspender, reanudar y finalizar', async ({
    page,
  }) => {
    await abrirHistoriaConMotivo(page, sembrada);
    // De la historia al caso y de ahi al plan: la misma visita, el motivo no se vuelve a pedir.
    await page.getByRole('link', { name: /Caso 1/ }).click();
    await page.getByRole('link', { name: 'Ver el plan de tratamiento' }).click();
    await expect(page).toHaveURL(new RegExp(`/casos/${casoId}/plan$`));
    await expect(page.getByText('Este caso todavía no tiene plan')).toBeVisible();

    // --- Crear --------------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Crear un plan' }).click();
    const editor = page.getByRole('region', { name: 'Crear un plan' });
    await editor.getByRole('button', { name: 'Crear el plan' }).click();
    await expect(editor.getByText('Los objetivos son obligatorios.')).toBeVisible();
    await expect(editor.getByText(/Cada item necesita una oferta/)).toBeVisible();

    await editor.getByRole('textbox', { name: 'Objetivos' }).fill('Fortalecer cuadriceps');
    await editor.getByRole('spinbutton', { name: 'Sesiones por semana (propuesta)' }).fill('2');
    await editor.getByRole('spinbutton', { name: 'Duración estimada (semanas)' }).fill('5');
    await editor
      .getByRole('combobox', { name: 'Oferta del item 1' })
      .selectOption({ label: sembrada.oferta.nombre });
    await editor.getByRole('spinbutton', { name: 'Sesiones planificadas' }).fill('10');
    await editor.getByRole('spinbutton', { name: 'Autorizadas (opcional)' }).fill('8');
    await editor.getByRole('button', { name: 'Crear el plan' }).click();

    await expect(page.getByText('Se creo el plan en borrador.')).toBeVisible();
    await expect(page.getByTestId('plan-estado')).toHaveText('Borrador');

    // --- Activar y avance derivado --------------------------------------------------------------
    await page.getByRole('button', { name: 'Activar el plan' }).click();
    await expect(page.getByTestId('plan-estado')).toHaveText('Activo');
    const avance = page.getByRole('list', { name: 'Avance por item' });
    await expect(avance).toContainText('0 de 10 realizadas');
    await expect(avance).toContainText('8 autorizadas');
    await expect(page.getByTestId('plan-avisos')).toContainText(
      'hay 10 sesiones planificadas y 8 autorizadas',
    );

    // --- Modificar: version 2, la 1 sigue consultable -----------------------------------------
    await page.getByRole('button', { name: 'Modificar el plan' }).click();
    const modificar = page.getByRole('region', { name: 'Modificar el plan' });
    await modificar.getByRole('spinbutton', { name: 'Sesiones planificadas' }).fill('12');
    await modificar
      .getByRole('textbox', { name: 'Motivo de la modificacion (opcional)' })
      .fill('Respuesta lenta al tratamiento');
    await modificar.getByRole('button', { name: 'Guardar los cambios' }).click();
    await expect(page.getByText('Se guardo una versión nueva del plan.')).toBeVisible();

    const versiones = page.getByRole('list', { name: 'Versiones del plan' });
    await expect(versiones.getByRole('listitem').filter({ hasText: /^Versión/ })).toHaveCount(2);
    await expect(versiones).toContainText('Respuesta lenta al tratamiento');
    await expect(avance).toContainText('0 de 12 realizadas');
    await page.getByRole('button', { name: 'Ver el avance de la versión 1' }).click();
    await expect(avance).toContainText('0 de 10 realizadas');

    // --- Suspender, reanudar, finalizar ---------------------------------------------------------
    await page.getByRole('button', { name: 'Suspender' }).click();
    await expect(page.getByText('El motivo es obligatorio.')).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Motivo para suspender o finalizar' })
      .fill('Viaje del paciente');
    await page.getByRole('button', { name: 'Suspender' }).click();
    await expect(page.getByTestId('plan-estado')).toHaveText('Suspendido');
    await expect(page.getByText('Viaje del paciente')).toBeVisible();

    await page.getByRole('button', { name: 'Reanudar el plan' }).click();
    await expect(page.getByTestId('plan-estado')).toHaveText('Activo');

    await page
      .getByRole('textbox', { name: 'Motivo para suspender o finalizar' })
      .fill('Objetivo alcanzado');
    await page.getByRole('button', { name: 'Finalizar' }).click();
    await expect(page.getByTestId('plan-estado')).toHaveText('Finalizado');
    // Un plan finalizado no se reabre: se ofrece crear otro.
    await expect(page.getByRole('button', { name: 'Activar el plan' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Crear un plan' })).toBeVisible();

    const estado = sql(`SELECT estado FROM plan_tratamiento WHERE caso_clinico_id=${casoId}`);
    expect(estado).toBe('FINALIZADO');
  });

  test('el enlace directo al plan sin motivo lo pide', async ({ page }) => {
    await abrirHistoriaConMotivo(page, sembrada);
    // Salir de la visita (a la ficha) la termina: volver por URL vuelve a pedir el motivo.
    await page.getByRole('link', { name: 'Ficha', exact: true }).click();
    await expect(
      page.locator('app-ayuda').getByText('Esta ficha no muestra nada clínico', { exact: true }),
    ).toBeAttached();
    await navegar(page, `/historia-clinica/personas/${sembrada.personaId}/casos/${casoId}/plan`);
    await expect(page.getByRole('heading', { name: 'Declara el motivo del acceso' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Motivo del acceso' }).fill(MOTIVO_DE_ACCESO);
    await page.getByRole('button', { name: 'Ver el plan' }).click();
    await expect(page.getByTestId('plan-estado')).toHaveText('Finalizado');
  });

  test('cada item muestra la vigencia de la autorizacion que lo respalda (0.107.0)', async ({
    page,
  }) => {
    // Una autorizacion APROBADA real de M17, de la misma persona, atada a un item del plan. El
    // vinculo exige que habilite hoy, asi que lo que se ve aca es la vigente; la vencida la cubre
    // el spec unitario de `vigenciaDeAutorizacion`.
    const desde = sumarDias(fechaLocal('America/Argentina/Cordoba'), -30);
    const hasta = sumarDias(desde, 240);
    const conMotivo = { 'X-Justificacion-Acceso': MOTIVO_DE_ACCESO };

    const admin = await ApiAkine.como(sembrada.emailAdmin, {
      organizationId: sembrada.organizationId,
    });
    let autorizacionId: number;
    try {
      const financiador = await crearFinanciador(admin, desde);
      const persona = { id: sembrada.personaId, nombre: '', apellido: '' };
      const coberturaId = await darCobertura(admin, persona, financiador, desde);
      const practicaId = await practicaGlobal(admin, 'KIN_SESION');
      const creada = await admin.exigir<{ id: number }>(
        'POST',
        `/api/v1/personas/${sembrada.personaId}/autorizaciones`,
        {
          coberturaId,
          practicaId,
          numero: `AUT-PLAN-${Date.now()}`,
          estadoInicial: 'APROBADA',
          cantidadAutorizada: 6,
          vigenciaDesde: desde,
          vigenciaHasta: hasta,
        },
      );
      autorizacionId = creada.id;
    } finally {
      await admin.cerrar();
    }

    const profesional = await ApiAkine.como(sembrada.email, {
      organizationId: sembrada.organizationId,
    });
    let otroCaso: number;
    try {
      // Otro caso del mismo paciente y la misma oferta: el primero ya tiene su plan finalizado.
      const caso = await profesional.pedir(
        'POST',
        `/api/v1/historias-clinicas/${sembrada.historiaClinicaId}/casos`,
        {
          ofertaId: sembrada.oferta.id,
          diagnosticoPresuntivo: 'Esguince de tobillo sintetico',
          confirmaPosibleDuplicado: true,
        },
        conMotivo,
      );
      expect(caso.status(), await caso.text()).toBe(201);
      otroCaso = ((await caso.json()) as { id: number }).id;

      const plan = await profesional.pedir(
        'POST',
        `/api/v1/casos-clinicos/${otroCaso}/planes`,
        {
          objetivos: 'Estabilidad articular',
          items: [{ ofertaId: sembrada.oferta.id, cantidadPlanificada: 8 }],
        },
        conMotivo,
      );
      expect(plan.status(), await plan.text()).toBe(201);
      const creado = (await plan.json()) as {
        id: number;
        version: number;
        versionVigente: { items: { id: number }[] };
      };

      const vinculo = await profesional.pedir(
        'POST',
        `/api/v1/planes-tratamiento/${creado.id}/autorizacion`,
        {
          planItemId: creado.versionVigente.items[0].id,
          autorizacionId,
          expectedVersion: creado.version,
        },
        conMotivo,
      );
      expect(vinculo.status(), await vinculo.text()).toBe(200);
    } finally {
      await profesional.cerrar();
    }

    await entrarConContexto(page, sembrada);
    await navegar(page, `/historia-clinica/personas/${sembrada.personaId}/casos/${otroCaso}/plan`);
    await page.getByRole('textbox', { name: 'Motivo del acceso' }).fill(MOTIVO_DE_ACCESO);
    await page.getByRole('button', { name: 'Ver el plan' }).click();

    const [anio, mes, dia] = hasta.split('-');
    const vigencia = page.getByTestId('plan-vigencia-autorizacion');
    await expect(vigencia).toHaveText(
      `autorización vigente hasta el ${dia}/${mes}/${anio} inclusive`,
    );
    await expect(vigencia).not.toHaveClass(/plan__vigencia--vencida/);
  });
});
