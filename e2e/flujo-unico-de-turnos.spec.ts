import { Locator, Page, expect, test } from '@playwright/test';

import { navegar } from './support/agenda-real';
import { ZONA_DE_HOY } from './support/centro-de-hoy';
import {
  HistoriaSembrada,
  MOTIVO_DE_ACCESO,
  entrarComoAdministradora,
  entrarConContexto,
  sembrarHistoria,
} from './support/historia-clinica';
import {
  ApiAkine,
  abrirLosFeriadosCercanos,
  fechaLocal,
  servicioAgendable,
  sumarDias,
} from './support/sembrado';

/**
 * El flujo unico de turnos de punta a punta, contra el backend real (TURNO.md y TURNO - Tecnico.md).
 *
 * <p>Todos los puntos de entrada abren el mismo panel: `punto de entrada -> contexto -> disponibilidad
 * -> validaciones -> confirmacion -> turno`. Cada test empieza en un punto de entrada distinto y
 * termina leyendo lo que quedo en el backend: un aviso verde no prueba que el turno exista.
 *
 * <p>Es un solo recorrido, en serie y sobre un centro propio: los turnos de un paso ocupan el horario
 * del siguiente, y el ultimo cierra la agenda de la profesional.
 */
test.describe('Flujo unico de turnos', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 });

  // Hay pasos que operan turnos de hoy: en una sede donde es de noche, no quedaria dia para hacerlo.
  const ZONA = ZONA_DE_HOY;

  let sembrada: HistoriaSembrada;
  let admin: ApiAkine;
  let profesional: ApiAkine;
  let casoId: number;
  let planId: number;
  let dia: string;

  interface Turno {
    readonly id: number;
    readonly inicio: string;
    readonly estado: string;
    readonly version: number;
    readonly motivoCancelacion?: string;
    readonly operativo?: {
      readonly estadoOperativo?: string;
      readonly casoId?: number;
      readonly planId?: number;
      readonly sobreturno?: boolean;
    };
  }

  const ruta = (sufijo: string): string =>
    `/api/v1/consultorios/${sembrada.consultorioId}${sufijo}`;

  const turnos = async (): Promise<Turno[]> => {
    const pagina = await admin.exigir<{ turnos: { turno: Turno }[] }>(
      'GET',
      ruta(`/turnos/personas/${sembrada.personaId}?size=100`),
    );
    return pagina.turnos.map((fila) => fila.turno);
  };

  const verTurno = (id: number): Promise<Turno> => admin.exigir('GET', ruta(`/turnos/${id}`));

  /** Reserva por la API, para los pasos que necesitan un turno previo. */
  const reservar = (inicio: string, personaId = sembrada.personaId): Promise<Turno> =>
    admin.exigir('POST', ruta(`/turnos/ofertas/${sembrada.oferta.id}`), {
      inicio,
      personaId,
      profesionalId: sembrada.membershipId,
      idempotencyKey: crypto.randomUUID(),
    });

  /** Instante UTC de una hora local de la sede. */
  const instante = (fecha: string, hora: string): string => {
    const supuesto = new Date(`${fecha}T${hora}:00Z`);
    const enLaSede = new Date(supuesto.toLocaleString('en-US', { timeZone: ZONA }));
    const enUtc = new Date(supuesto.toLocaleString('en-US', { timeZone: 'UTC' }));
    return new Date(supuesto.getTime() - (enLaSede.getTime() - enUtc.getTime()))
      .toISOString()
      .replace('.000', '');
  };

  const panel = (page: Page, titulo: string): Locator => page.getByRole('dialog', { name: titulo });

  const avisos = (page: Page): Locator => page.getByRole('region', { name: 'Notificaciones' });

  const apellido = (): string => sembrada.nombreCompleto.split(',')[0];

  async function elegirPaciente(dialogo: Locator): Promise<void> {
    await dialogo.getByLabel('Buscar paciente').fill(apellido());
    await dialogo.getByRole('button', { name: new RegExp(apellido()) }).click();
  }

  async function abrirTurnoEnLaAgenda(page: Page, fecha: string, hora: string): Promise<Locator> {
    await navegar(page, `/agenda?fecha=${fecha}`);
    await page.getByRole('button', { name: new RegExp(`^${hora} a .*${apellido()}`) }).click();
    return page.getByRole('dialog');
  }

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
        horaDesde: '00:00',
        horaHasta: '23:45',
      });
    }
    await abrirLosFeriadosCercanos(admin, sembrada.consultorioId, sembrada.membershipId, ZONA);
    // Sin precio vigente la sesion no se puede cerrar.
    await admin.exigir('POST', ruta(`/ofertas/${sembrada.oferta.id}/precios-particulares`), {
      importe: 1000,
      moneda: 'ARS',
      vigenciaDesde: fechaLocal(ZONA),
    });

    const conMotivo = { 'X-Justificacion-Acceso': MOTIVO_DE_ACCESO };
    const caso = await profesional.pedir(
      'POST',
      `/api/v1/historias-clinicas/${sembrada.historiaClinicaId}/casos`,
      { ofertaId: sembrada.oferta.id, diagnosticoPresuntivo: 'Lumbalgia sintetica' },
      conMotivo,
    );
    expect(caso.status(), await caso.text()).toBe(201);
    casoId = ((await caso.json()) as { id: number }).id;

    const plan = await profesional.pedir(
      'POST',
      `/api/v1/casos-clinicos/${casoId}/planes`,
      {
        objetivos: 'Recuperar movilidad',
        items: [{ ofertaId: sembrada.oferta.id, cantidadPlanificada: 6 }],
      },
      conMotivo,
    );
    expect(plan.status(), await plan.text()).toBe(201);
    const creado = (await plan.json()) as { id: number; version: number };
    planId = creado.id;
    const activacion = await profesional.pedir(
      'POST',
      `/api/v1/planes-tratamiento/${planId}/activacion`,
      { expectedVersion: creado.version },
      conMotivo,
    );
    expect(activacion.ok(), await activacion.text()).toBe(true);

    // Un dia sin feriados, para que nada dependa de la fecha en que corre.
    const calendario = await admin.exigir<{ feriados: { fecha: string }[] }>(
      'GET',
      ruta(`/calendario?desde=${fechaLocal(ZONA, 3)}&hasta=${fechaLocal(ZONA, 20)}`),
    );
    const feriados = new Set(calendario.feriados.map((f) => f.fecha));
    dia = fechaLocal(ZONA, 3);
    while (feriados.has(dia)) {
      dia = sumarDias(dia, 1);
    }
  });

  test.afterAll(async () => {
    await admin?.cerrar();
    await profesional?.cerrar();
  });

  test('Turno -> marcar ausente: un turno ya empezado, sin liberar el lugar', async ({ page }) => {
    test.setTimeout(240_000);
    // Ausente solo se marca sobre un turno que ya empezo, y nada se maquilla en la base: una prestacion
    // de un minuto tiene horarios cada minuto, y se espera a que pase el proximo. Va primero porque
    // despues los turnos de la profesional ocupan lo que viene de hoy.
    const oferta = await admin.exigir<{ id: number }>('POST', ruta('/ofertas'), {
      servicioId: await servicioAgendable(admin),
      nombreComercial: `Un minuto ${Date.now()}`,
      capacidad: 1,
      duracionMinutos: 1,
      requiereProfesional: true,
      requiereEspacio: false,
    });
    const inicio = new Date(Math.ceil((Date.now() + 60_000) / 60_000) * 60_000);
    const turno = await admin.exigir<Turno>('POST', ruta(`/turnos/ofertas/${oferta.id}`), {
      inicio: inicio.toISOString().replace('.000', ''),
      personaId: sembrada.personaId,
      profesionalId: sembrada.membershipId,
      idempotencyKey: crypto.randomUUID(),
    });

    await entrarComoAdministradora(page, sembrada);
    await page.waitForTimeout(Math.max(0, inicio.getTime() + 2_000 - Date.now()));
    const hora = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: ZONA,
    }).format(inicio);
    const dialogo = await abrirTurnoEnLaAgenda(page, fechaLocal(ZONA), hora);
    await dialogo.getByText('Más acciones').click();
    await dialogo.getByRole('button', { name: 'Marcar ausente' }).click();
    await dialogo.getByRole('button', { name: 'Registrar la ausencia' }).click();
    await expect(dialogo.locator('.estado-turno')).toContainText('Ausente');

    const leido = await verTurno(turno.id);
    expect(leido.estado).toBe('AUSENTE');
    expect(leido.inicio, 'la ausencia no mueve ni libera el turno').toBe(turno.inicio);

    await admin.exigir('DELETE', ruta(`/ofertas/${oferta.id}`), { reason: 'Era de un solo test' });
  });

  test('Agenda -> espacio disponible -> paciente -> confirmar turno', async ({ page }) => {
    await entrarComoAdministradora(page, sembrada);
    await navegar(page, `/agenda?fecha=${dia}&por=box`);
    await page.getByRole('button', { name: 'Profesionales', exact: true }).click();

    await page.getByRole('button', { name: new RegExp(`Nuevo turno ${dia} a las 12:00`) }).click();
    const dialogo = panel(page, 'Nuevo turno');
    const scroll = await page.locator('.grilla').evaluate((grilla) => grilla.scrollTop);
    expect(scroll, 'la grilla esta scrolleada: si vuelve a cero se nota').toBeGreaterThan(0);
    await expect(dialogo.getByText('Profesional')).toBeVisible();
    await elegirPaciente(dialogo);
    // Tiene un solo plan activo: viene elegido, con su prestacion y sus contadores. Una primera
    // consulta o un turno suelto se pide a proposito.
    await expect(dialogo.getByText('Planificadas:')).toBeVisible();
    await dialogo.getByLabel('Caso / Plan').selectOption('');
    // La sede tiene una sola prestacion: tampoco se pregunta.
    await expect(
      dialogo.locator('.flujo__dato', { hasText: sembrada.oferta.nombre }),
    ).toBeVisible();
    await expect(dialogo.getByText(/12:00/)).toBeVisible();

    await dialogo.getByRole('button', { name: 'Confirmar turno' }).click();
    await expect(avisos(page).getByText('Turno creado correctamente.')).toBeVisible();

    // La agenda se queda donde estaba, con el turno a la vista.
    await expect(dialogo).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`fecha=${dia}`));
    await expect(
      page.getByRole('button', { name: new RegExp(`^12:00 a .*${apellido()}`) }),
    ).toBeVisible();
    expect(await page.locator('.grilla').evaluate((grilla) => grilla.scrollTop)).toBe(scroll);

    const reservado = (await turnos()).find((t) => t.inicio === instante(dia, '12:00'));
    expect(reservado, 'el turno quedo en el backend, a esa hora').toBeDefined();
    expect(reservado?.operativo?.planId, 'turno suelto: sin plan').toBeFalsy();
  });

  test('Paciente -> nuevo turno -> disponibilidad -> confirmar', async ({ page }) => {
    const antes = (await turnos()).length;
    await entrarComoAdministradora(page, sembrada);
    await navegar(page, `/pacientes/${sembrada.personaId}`);
    await page.getByRole('button', { name: 'Nuevo turno' }).click();

    const dialogo = panel(page, 'Nuevo turno');
    // Lo que ya se sabe no se vuelve a preguntar.
    await expect(dialogo.getByLabel('Buscar paciente')).toBeHidden();
    await expect(dialogo.getByText(sembrada.nombreCompleto).first()).toBeVisible();
    await expect(dialogo.getByLabel('Prestación', { exact: true })).toBeHidden();

    await dialogo.getByRole('button', { name: 'Primer disponible' }).click();
    await dialogo.getByRole('button', { name: 'Confirmar turno' }).click();
    await expect(avisos(page).getByText('Turno creado correctamente.')).toBeVisible();

    await expect.poll(async () => (await turnos()).length).toBe(antes + 1);
    await expect(page.getByRole('list', { name: 'Próximos turnos' })).toBeVisible();
  });

  test('Plan -> programar proxima sesion -> programar varias', async ({ page }) => {
    await entrarConContexto(page, sembrada);
    await navegar(page, `/historia-clinica/personas/${sembrada.personaId}/casos/${casoId}/plan`);

    // Con turnos ya dados la profesional tiene relacion asistencial y la historia no pide motivo.
    const proximaSesion = page.getByRole('button', { name: 'Programar próxima sesión' });
    const motivo = page.getByRole('textbox', { name: 'Motivo del acceso' });
    await expect(proximaSesion.or(motivo).first()).toBeVisible();
    if (await motivo.isVisible()) {
      await motivo.fill(MOTIVO_DE_ACCESO);
      await page.getByRole('button', { name: /^Ver/ }).click();
    }
    await proximaSesion.click();
    const proxima = panel(page, 'Nuevo turno');
    // El contexto del plan ya viene: paciente, caso, plan y prestacion.
    await expect(proxima.getByLabel('Buscar paciente')).toBeHidden();
    await expect(proxima.getByLabel('Caso / Plan')).not.toHaveValue('');
    await expect(proxima.getByText('Planificadas:')).toBeVisible();
    await proxima.getByRole('button', { name: 'Primer disponible' }).click();
    await proxima.getByRole('button', { name: 'Confirmar turno' }).click();
    await expect(avisos(page).getByText('Turno creado correctamente.')).toBeVisible();

    await expect
      .poll(async () => (await turnos()).filter((t) => t.operativo?.planId === planId).length)
      .toBe(2);

    await page.getByRole('button', { name: 'Programar sesiones restantes' }).click();
    const varias = panel(page, 'Programar varias sesiones');
    // La cantidad sale de lo que le queda al plan.
    await expect(varias.getByText('Pendientes:')).toBeVisible();
    await expect(varias.getByLabel('Cantidad de sesiones')).toHaveValue('4');
    await varias.getByLabel('Horario preferido').fill('15:00');
    await varias.getByLabel('Fecha inicial').fill(sumarDias(dia, 7));
    await varias.getByLabel('Cantidad de sesiones').fill('2');
    await varias.getByLabel('Lun', { exact: true }).check();
    await varias.getByLabel('Jue', { exact: true }).check();
    await varias.getByRole('button', { name: 'Buscar disponibilidad' }).click();
    await expect(varias.getByRole('table')).toBeVisible();
    await varias.getByRole('button', { name: /^Confirmar/ }).click();
    await expect(avisos(page).getByText(/2 turnos|sesiones programadas/i)).toBeVisible();

    await expect
      .poll(async () => (await turnos()).filter((t) => t.operativo?.planId === planId).length)
      .toBe(4);
    const delPlan = (await turnos()).filter((t) => t.operativo?.planId === planId);
    expect(delPlan.every((t) => t.operativo?.casoId === casoId)).toBe(true);
  });

  test('El plan no acepta mas turnos que sus sesiones pendientes', async () => {
    // Seis planificadas, cuatro programadas por los pasos anteriores: quedan dos y se piden cuatro.
    const pedido = await admin.pedir('POST', ruta('/series-de-turnos'), {
      ofertaId: sembrada.oferta.id,
      personaId: sembrada.personaId,
      profesionalId: sembrada.membershipId,
      diasSemana: [2, 3, 5, 6],
      hora: '17:00',
      fechaDesde: sumarDias(dia, 21),
      cantidad: 4,
      planId,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(pedido.status(), await pedido.text()).toBe(409);
    expect(((await pedido.json()) as { type: string }).type).toContain('plan-sin-sesiones');
  });

  test('Turno -> reprogramar: es el mismo turno y queda en el historial', async ({ page }) => {
    const turno = await reservar(instante(dia, '11:00'));
    await entrarComoAdministradora(page, sembrada);

    const dialogo = await abrirTurnoEnLaAgenda(page, dia, '11:00');
    await dialogo.getByText('Más acciones').click();
    await dialogo.getByRole('button', { name: 'Reprogramar' }).click();
    await dialogo.locator('.horario').first().click();
    await dialogo.getByRole('button', { name: 'Reprogramar' }).click();
    await expect(avisos(page).getByText(/reprogramado/i)).toBeVisible();

    const movido = await verTurno(turno.id);
    expect(movido.id).toBe(turno.id);
    expect(movido.inicio).not.toBe(turno.inicio);
    await expect(page).toHaveURL(new RegExp(`fecha=${dia}`));

    const eventos = await admin.exigir<{ tipo: string; actorNombre?: string }[]>(
      'GET',
      ruta(`/turnos/${turno.id}/historial`),
    );
    const reprogramacion = eventos.find((e) => e.tipo === 'REPROGRAMACION');
    expect(reprogramacion).toBeDefined();
    expect(reprogramacion?.actorNombre, 'el historial dice quien lo hizo').toBeTruthy();
  });

  test('Turno -> cancelar: libera el lugar y conserva el motivo', async ({ page }) => {
    const turno = await reservar(instante(dia, '21:00'));
    await entrarComoAdministradora(page, sembrada);

    const dialogo = await abrirTurnoEnLaAgenda(page, dia, '21:00');
    await dialogo.getByText('Más acciones').click();
    await dialogo.getByRole('button', { name: 'Cancelar turno' }).click();
    await dialogo.getByRole('button', { name: 'Cancelar turno' }).click();
    await expect(avisos(page).getByText(/Turno cancelado/)).toBeVisible();

    const cancelado = await verTurno(turno.id);
    expect(cancelado.estado).toBe('CANCELADO');
    expect(cancelado.motivoCancelacion).toBeTruthy();

    // El lugar vuelve a la agenda: se puede reservar de nuevo el mismo horario.
    const otra = await reservar(instante(dia, '21:00'));
    expect(otra.id).not.toBe(turno.id);
  });

  test('Turno -> marcar presente -> iniciar atencion -> sesion -> programar proxima', async ({
    page,
  }) => {
    // Hoy, lo mas tarde posible: recepcion solo opera turnos del dia y la franja llega a las 23:45.
    const hoy = fechaLocal(ZONA);
    const turno = await reservar(instante(hoy, '23:00'));

    await entrarConContexto(page, sembrada);
    const dialogo = await abrirTurnoEnLaAgenda(page, hoy, '23:00');
    await dialogo.getByRole('button', { name: 'Paciente presente' }).click();
    await expect(dialogo.locator('.estado-turno')).toContainText('Paciente presente');
    const leido = await admin.exigir<{ recepcion?: { estado: string } }>(
      'GET',
      ruta(`/turnos/${turno.id}`),
    );
    expect(leido.recepcion?.estado).toBeTruthy();

    await dialogo.getByRole('button', { name: 'Iniciar atención' }).click();
    await expect(page).toHaveURL(new RegExp(`/atencion/turnos/${turno.id}$`));

    // La sesion se cierra por la API: el formulario clinico tiene su propio E2E. Iniciar es
    // idempotente: devuelve la que abrio la pantalla, y si hubiera dos el unique lo impediria.
    const sesion = await profesional.exigir<{ id: number; version: number }>(
      'POST',
      ruta(`/sesiones/turnos/${turno.id}`),
    );
    await profesional.exigir('POST', ruta(`/sesiones/${sesion.id}/cierre`), {
      asistencia: 'PRESENTE',
      notaDeCierre: 'Sesion sintetica de los E2E: movilidad conservada, sin dolor.',
      version: sesion.version,
    });

    const antes = (await turnos()).length;
    await page.reload();
    await page.getByRole('button', { name: 'Programar próxima sesión' }).click();
    const proxima = panel(page, 'Nuevo turno');
    await expect(proxima.getByLabel('Buscar paciente')).toBeHidden();
    await proxima.getByRole('button', { name: 'Primer disponible' }).click();
    await proxima.getByRole('button', { name: 'Confirmar turno' }).click();
    await expect(avisos(page).getByText('Turno creado correctamente.')).toBeVisible();
    await expect.poll(async () => (await turnos()).length).toBe(antes + 1);
  });

  test('Horario ocupado -> impide la doble reserva, ofrece alternativas y sobreturno', async ({
    page,
  }) => {
    await entrarComoAdministradora(page, sembrada);
    await navegar(page, `/agenda?fecha=${dia}`);
    await page.getByRole('button', { name: new RegExp(`Nuevo turno ${dia} a las 15:00`) }).click();
    const dialogo = panel(page, 'Nuevo turno');
    await elegirPaciente(dialogo);
    await expect(dialogo.getByRole('button', { name: 'Confirmar turno' })).toBeEnabled();

    // Otro puesto toma ese mismo horario mientras el panel esta abierto.
    const persona = await admin.exigir<{ id: number }>('POST', '/api/v1/personas', {
      nombre: 'Otra',
      apellido: `Persona${Date.now()}`,
    });
    await admin.exigir('POST', `/api/v1/personas/${persona.id}/perfil-paciente`, {});
    const ganador = await reservar(instante(dia, '15:00'), persona.id);

    await dialogo.getByRole('button', { name: 'Confirmar turno' }).click();
    await expect(dialogo.getByText('Este horario acaba de ser reservado')).toBeVisible();
    await expect(dialogo.getByText('Opciones disponibles')).toBeVisible();

    const enEseHorario = (await turnos()).filter((t) => t.inicio === instante(dia, '15:00'));
    expect(enEseHorario, 'la persona del panel no quedo en el horario ocupado').toHaveLength(0);
    expect((await verTurno(ganador.id)).estado).not.toBe('CANCELADO');

    // Sobreturno: con permiso, motivo obligatorio y marcado.
    await dialogo.getByRole('button', { name: 'Crear sobreturno' }).click();
    await dialogo.getByRole('button', { name: 'Crear sobreturno' }).last().click();
    await expect(dialogo.getByText('El motivo es obligatorio')).toBeVisible();
    await dialogo.getByLabel('Motivo del sobreturno').fill('Urgencia sintetica');
    await dialogo.getByRole('button', { name: 'Crear sobreturno' }).last().click();
    await expect(avisos(page).getByText('Turno creado correctamente.')).toBeVisible();

    await expect
      .poll(async () =>
        (await turnos()).filter(
          (t) => t.inicio === instante(dia, '15:00') && t.operativo?.sobreturno,
        ),
      )
      .toHaveLength(1);
  });

  test('Paciente nuevo -> alta rapida sin salir del flujo -> confirmar', async ({ page }) => {
    const apellidoNuevo = `Nuevo${Date.now()}`;
    const documento = String(Math.floor(20_000_000 + Math.random() * 30_000_000));
    await entrarComoAdministradora(page, sembrada);
    await navegar(page, `/agenda?fecha=${dia}`);
    await page.getByRole('button', { name: new RegExp(`Nuevo turno ${dia} a las 18:00`) }).click();

    const dialogo = panel(page, 'Nuevo turno');
    await dialogo.getByLabel('Buscar paciente').fill(apellidoNuevo);
    await expect(dialogo.getByText('No encontramos pacientes.')).toBeVisible();
    await dialogo.getByRole('button', { name: 'Crear paciente' }).click();
    await dialogo.getByLabel('Nombre', { exact: true }).fill('Rocio');
    await dialogo.getByLabel('Apellido', { exact: true }).fill(apellidoNuevo);
    await dialogo.getByLabel('DNI', { exact: true }).fill(documento);
    await dialogo.getByLabel('Teléfono', { exact: true }).fill('3514000000');
    await dialogo.getByRole('button', { name: 'Crear paciente' }).click();

    // Sigue en el mismo panel, con la misma celda y la persona ya elegida.
    await expect(dialogo.locator('.flujo__persona-elegida')).toContainText(apellidoNuevo);
    await dialogo.getByRole('button', { name: 'Confirmar turno' }).click();
    await expect(avisos(page).getByText('Turno creado correctamente.')).toBeVisible();

    const leida = await admin.exigir<{ content: { id: number; esPaciente: boolean }[] }>(
      'GET',
      `/api/v1/personas?q=${apellidoNuevo}`,
    );
    expect(leida.content).toHaveLength(1);
    expect(leida.content[0].esPaciente, 'la persona quedo como paciente').toBe(true);
    const suyos = await admin.exigir<{ turnos: { turno: { inicio: string } }[] }>(
      'GET',
      ruta(`/turnos/personas/${leida.content[0].id}`),
    );
    expect(suyos.turnos.map((t) => t.turno.inicio)).toEqual([instante(dia, '18:00')]);
  });

  test('Caso -> nuevo turno: viene con su caso; un plan agotado avisa y se sigue sin plan', async ({
    page,
  }) => {
    const antes = (await turnos()).length;
    await entrarConContexto(page, sembrada);
    await navegar(page, `/historia-clinica/personas/${sembrada.personaId}/casos/${casoId}`);
    const nuevoTurno = page.getByRole('button', { name: 'Nuevo turno', exact: true });
    const motivo = page.getByRole('textbox', { name: 'Motivo del acceso' });
    await expect(nuevoTurno.or(motivo).first()).toBeVisible();
    if (await motivo.isVisible()) {
      await motivo.fill(MOTIVO_DE_ACCESO);
      await page.getByRole('button', { name: /^Ver/ }).click();
    }
    await nuevoTurno.click();

    const dialogo = panel(page, 'Nuevo turno');
    await expect(dialogo.getByLabel('Buscar paciente')).toBeHidden();
    await expect(dialogo.getByLabel('Caso / Plan')).toHaveValue(`plan:${planId}`);
    await expect(
      dialogo.getByText('No se pueden programar más turnos para esta prestación'),
    ).toBeVisible();
    await expect(dialogo.getByRole('button', { name: 'Confirmar turno' })).toBeDisabled();

    await dialogo.getByLabel('Caso / Plan').selectOption(`caso:${casoId}`);
    await dialogo.getByRole('button', { name: 'Primer disponible' }).click();
    await dialogo.getByRole('button', { name: 'Confirmar turno' }).click();
    await expect(avisos(page).getByText('Turno creado correctamente.')).toBeVisible();

    await expect.poll(async () => (await turnos()).length).toBe(antes + 1);
    const delCasoSinPlan = (await turnos()).filter(
      (t) => t.operativo?.casoId === casoId && !t.operativo?.planId,
    );
    expect(delCasoSinPlan).toHaveLength(1);
  });

  test('Profesional -> nuevo turno desde su horario, y recepcion abre el mismo panel', async ({
    page,
  }) => {
    await entrarComoAdministradora(page, sembrada);
    await navegar(page, '/horarios');
    await page.getByLabel('Elegí un profesional').selectOption(String(sembrada.membershipId));
    await page.getByRole('button', { name: 'Nuevo turno', exact: true }).click();
    const dialogo = panel(page, 'Nuevo turno');
    await expect(dialogo.getByLabel('Profesional', { exact: true })).toHaveValue(
      String(sembrada.membershipId),
    );
    await dialogo.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialogo).toBeHidden();

    await navegar(page, '/agenda/recepcion');
    await page.getByRole('button', { name: 'Nuevo turno', exact: true }).first().click();
    await expect(panel(page, 'Nuevo turno')).toBeVisible();
    await expect(page).toHaveURL(/\/agenda\/recepcion/);
  });

  test('Sin disponibilidad -> lista de espera -> asignar el horario', async ({ page }) => {
    await entrarComoAdministradora(page, sembrada);

    // Bloquear la agenda desde la agenda: tiene turnos adentro, asi que primero avisa.
    await navegar(page, `/agenda?fecha=${dia}`);
    await page.getByRole('button', { name: 'Bloquear agenda' }).click();
    const bloqueo = panel(page, 'Bloquear agenda');
    await bloqueo.getByLabel('A quién afecta').selectOption(String(sembrada.membershipId));
    await bloqueo.getByLabel('Tipo').selectOption({ label: 'Licencia' });
    await bloqueo.getByLabel('Fecha desde').fill(fechaLocal(ZONA));
    await bloqueo.getByLabel('Fecha hasta').fill(sumarDias(fechaLocal(ZONA), 70));
    await bloqueo.getByRole('button', { name: 'Revisar' }).click();
    await expect(bloqueo.getByText(/Este bloqueo afecta [0-9]+ turnos?/)).toBeVisible();
    await bloqueo.getByRole('button', { name: 'Crear bloqueo igualmente' }).click();
    await expect(avisos(page).getByText(/bloque/i)).toBeVisible();

    await navegar(page, `/pacientes/${sembrada.personaId}`);
    await expect(page.getByRole('heading', { name: 'Próximos turnos' })).toBeVisible();
    await page.getByRole('button', { name: 'Nuevo turno', exact: true }).click();
    const dialogo = panel(page, 'Nuevo turno');
    // El plan quedo sin pendientes en los pasos anteriores: no viene elegido.
    await expect(dialogo.getByLabel('Caso / Plan')).toHaveValue('');
    await expect(dialogo.getByText('No encontramos disponibilidad')).toBeVisible();
    await dialogo.getByRole('button', { name: 'Agregar a lista de espera' }).click();

    const espera = panel(page, 'Agregar a la lista de espera');
    await espera.getByRole('button', { name: /^Agregar/ }).click();
    await expect(avisos(page).getByText(/lista de espera/i)).toBeVisible();

    const anotados = await admin.exigir<{ content: { id: number; estado: string }[] }>(
      'GET',
      ruta('/lista-de-espera'),
    );
    expect(anotados.content.filter((e) => e.estado === 'ACTIVA')).toHaveLength(1);

    // Se libera la agenda: el horario se asigna desde la lista, a la misma persona.
    const agenda = await admin.exigir<{ bloqueos: { excepcionId: number }[] }>(
      'GET',
      ruta(`/agenda/operativa?desde=${dia}&hasta=${sumarDias(dia, 1)}`),
    );
    await admin.exigir('DELETE', ruta(`/excepciones/${agenda.bloqueos[0].excepcionId}`), {
      reason: 'Se levanta la licencia sintetica',
    });

    const antes = (await turnos()).length;
    await navegar(page, '/agenda/lista-de-espera');
    const lista = page.getByRole('region', { name: 'Lista de espera de la sede' }).last();
    await expect(lista).toContainText(apellido());
    await lista.getByRole('button', { name: /^Asignar/ }).click();
    await page.locator('.horario').first().click();
    await expect(avisos(page).getByText('Turno asignado.')).toBeVisible();

    await expect.poll(async () => (await turnos()).length).toBe(antes + 1);
    const despues = await admin.exigir<{ content: { estado: string }[] }>(
      'GET',
      ruta('/lista-de-espera'),
    );
    expect(despues.content.map((e) => e.estado)).toEqual(['ASIGNADA']);
  });

  test('Box: la celda de un box lo deja elegido y el turno se ve en su columna', async ({
    page,
  }) => {
    const nombreBox = `Box E2E ${Date.now()}`;
    const espacio = await admin.exigir<{ id: number }>(
      'POST',
      `/api/v1/organizations/${sembrada.organizationId}/consultorios/${sembrada.consultorioId}/espacios`,
      { name: nombreBox, tipo: 'BOX', capacidad: 1 },
    );
    const nombreOferta = `Magneto ${Date.now()}`;
    const oferta = await admin.exigir<{ id: number; version: number }>('POST', ruta('/ofertas'), {
      servicioId: await servicioAgendable(admin),
      nombreComercial: nombreOferta,
      capacidad: 1,
      duracionMinutos: 30,
      requiereProfesional: true,
      requiereEspacio: true,
    });
    const conProfesional = await admin.exigir<{ ofertaVersion: number }>(
      'PUT',
      ruta(`/ofertas/${oferta.id}/habilitaciones/profesionales`),
      { expectedVersion: oferta.version, ids: [sembrada.membershipId] },
    );
    await admin.exigir('PUT', ruta(`/ofertas/${oferta.id}/habilitaciones/espacios`), {
      expectedVersion: conProfesional.ofertaVersion,
      ids: [espacio.id],
    });

    await entrarComoAdministradora(page, sembrada);
    await navegar(page, `/agenda?fecha=${dia}&por=box`);
    await page
      .getByRole('button', { name: new RegExp(`Nuevo turno ${dia} a las 09:00, ${nombreBox}`) })
      .click();
    const dialogo = panel(page, 'Nuevo turno');
    await elegirPaciente(dialogo);
    await dialogo
      .getByLabel('Prestación', { exact: true })
      .selectOption({ label: `${nombreOferta} · 30 min` });
    await expect(dialogo.getByRole('button', { name: 'Confirmar turno' })).toBeEnabled();
    await dialogo.getByRole('button', { name: 'Confirmar turno' }).click();
    await expect(avisos(page).getByText('Turno creado correctamente.')).toBeVisible();

    await expect(page).toHaveURL(/por=box/);
    await expect(
      page.getByRole('button', { name: new RegExp(`^09:00 a .*${apellido()}`) }),
    ).toBeVisible();
    const delBox = await admin.exigir<{
      turnos: { turno: { espacioId?: number; inicio: string } }[];
    }>(
      'GET',
      ruta(`/agenda/operativa?desde=${dia}&hasta=${sumarDias(dia, 1)}&espacioId=${espacio.id}`),
    );
    expect(delBox.turnos.map((t) => t.turno.inicio)).toEqual([instante(dia, '09:00')]);
    expect(delBox.turnos[0].turno.espacioId).toBe(espacio.id);
  });
});
