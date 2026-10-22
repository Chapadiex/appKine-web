import { randomUUID } from 'node:crypto';

import { Browser, Page, test } from '@playwright/test';

import { nonce } from './support/akine';
import { ingresar, navegar, problemaDe, respuestaDe } from './support/agenda-real';
import {
  CentroPropio,
  cerrarCentroPropio,
  dato,
  expect,
  movimientoDeCaja,
  sembrarCentroPropio,
} from './support/centro-propio';
import {
  ApiAkine,
  Centro,
  Obligacion,
  Persona,
  abrirLaCaja,
  cajaAbierta,
  crearConvenio,
  crearFinanciador,
  crearOferta,
  crearPersona,
  darCobertura,
  dejarLaCajaCerrada,
  fechaLocal,
  practicaGlobal,
  sumarDias,
  uriDeProblema,
} from './support/sembrado';
import { instanteEnZona } from './support/sembrado-asistencia';
import { JUSTIFICACION, exigirCon, ingresarAlCentro } from './support/sembrado-pantallas-098';

/**
 * E2E del circuito COMPLETO de la segunda entrega (F9), contra el backend real, de punta a punta y
 * sin `route.fulfill`: la clase → la inscripcion con lista de espera y promocion → la asistencia en
 * lote que consume el pase → la derivacion al Caso → la atencion grupal → el cierre de la Sesion →
 * la deuda en la cuenta corriente → el cobro en la caja.
 *
 * <p>Los specs de cada pantalla (`flujo-clases`, `flujo-asistencia`, `flujo-pases`,
 * `flujo-atencion-grupal`, `flujo-caja`) prueban cada tramo por separado. Lo que solo prueba este
 * es el ENCADENAMIENTO: que lo que deja un modulo sea lo que el siguiente necesita. La deuda que se
 * cobra en la caja es la que nacio en `activity` (la venta del pase) o en `billing` al cerrar la
 * Sesion que abrio `clinical` desde la derivacion de `activity`.
 *
 * <p>Dos caminos economicos, uno por test, porque el backend los separa (U-42, AKINE-08.05):
 *
 * <ol>
 *   <li><b>Con pase</b>: la clase se cobra por su esquema, sobre la ASISTENCIA. Cerrar la Sesion de
 *       una participante sin cobertura <b>no devenga</b> otra deuda —seria cobrar dos veces la misma
 *       clase—, y lo que se cobra en la caja es la venta del pase.</li>
 *   <li><b>Con obra social</b>: cerrar la Sesion de una participante con cobertura devenga por
 *       convenio la deuda del financiador y el coseguro, y el coseguro se cobra en la caja.</li>
 * </ol>
 *
 * <p><b>Centro propio</b> (`support/centro-propio.ts`): abre y cierra la caja, que es una por sede.
 * La derivacion se hace por pantalla, como la profesional, desde el panel de atencion grupal
 * ("Derivar a un caso"): el Caso se abre por la API porque pide diagnostico presuntivo.
 */
test.describe.configure({ mode: 'default' });

/** Bloque de dias de la clase: futura (inscribir a una que ya empezo es 409) y cercana (el pase). */
const DIAS_DE_LA_CLASE = { desde: 4, hasta: 10 } as const;
const PRECIO_DEL_PASE = 15_000;
const INICIAL = 1_000;
const IMPORTES = { total: 12_000, financiador: 9_000, coseguro: 3_000 } as const;
const LOTE = /\/clases\/\d+\/asistencias\/lote$/;

interface Clase {
  readonly id: number;
  readonly titulo: string;
}

interface DeudaDeLaPersona extends Obligacion {
  readonly version: number;
  readonly convenio?: { readonly convenioNombre?: string };
}

test.describe('Circuito de F9 de punta a punta contra el backend real', () => {
  let propio: CentroPropio;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    propio = await sembrarCentroPropio('circuitof9');
  });

  test.afterAll(async () => {
    if (propio !== undefined) {
      await dejarLaCajaCerrada(propio.api, propio.centro);
    }
    await cerrarCentroPropio(propio);
  });

  test('con pase: espera, promocion, consumo, atencion grupal sin doble cobro y cobro de la venta', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const { api, profesional, centro } = propio;
    const base = `/api/v1/consultorios/${centro.consultorioId}`;

    // --- Sembrado: oferta POR_PACK que genera registro clinico, su producto y tres personas ---
    const oferta = await crearOferta(api, centro, {
      nombre: `Pilates clinico E2E ${nonce()}`,
      habilitarProfesional: false,
      extra: {
        modalidad: 'GRUPAL',
        capacidad: 8,
        requiereProfesional: false,
        esquemaCobro: 'POR_PACK',
        generaRegistroClinico: true,
      },
    });
    const producto = `Pack circuito ${nonce()}`;
    const { id: productoId } = await api.exigir<{ id: number }>('POST', `${base}/productos`, {
      ofertaId: oferta.id,
      nombre: producto,
      creditos: 2,
      precio: PRECIO_DEL_PASE,
      moneda: 'ARS',
      vigenciaDias: 60,
      vigenciaDesde: fechaLocal(centro.timezone),
    });
    const clase = await programarClase(api, centro, oferta.id, 2);
    const [ana, bruno, carla] = [
      await crearPersona(api, { nombre: 'Ana' }),
      await crearPersona(api, { nombre: 'Bruno' }),
      await crearPersona(api, { nombre: 'Carla' }),
    ];

    // --- 1. Inscripcion por pantalla: cupo lleno, lista de espera y promocion -----------------
    await ingresar(page, centro);
    await navegar(page, `/clases/${clase.id}`);
    await expect(page.getByRole('heading', { name: clase.titulo, level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'La clase', exact: true })).toContainText(
      oferta.nombre,
    );
    for (const persona of [ana, bruno]) {
      await inscribir(page, persona);
      await expect(
        page.getByText(`${persona.apellido}, ${persona.nombre} quedo inscripta con lugar.`),
      ).toBeVisible();
    }
    const rechazo = respuestaDe(page, 'POST', /\/inscripciones$/);
    await inscribir(page, carla);
    const completa = await rechazo;
    expect(completa.status()).toBe(409);
    expect((await problemaDe(completa)).type).toBe(uriDeProblema('clase-completa'));
    await page.getByRole('button', { name: 'Anotar en la lista de espera' }).click();
    await expect(
      page.getByText(`${carla.apellido}, ${carla.nombre} quedo en la lista de espera, posicion 1.`),
    ).toBeVisible();

    await page
      .getByRole('button', { name: `Dar de baja a ${bruno.apellido}, ${bruno.nombre}` })
      .click();
    await page.getByLabel('Motivo de la baja').fill('Cambio de horario laboral');
    const baja = respuestaDe(page, 'POST', /\/inscripciones\/\d+\/cancelacion$/);
    await page.getByRole('button', { name: 'Dar de baja', exact: true }).click();
    expect((await baja).status()).toBe(200);
    await expect(
      page.getByText(
        `${carla.apellido}, ${carla.nombre} entro desde la lista de espera y recibe un aviso.`,
      ),
    ).toBeVisible();

    // --- 2. Venta del pase: a Ana por pantalla, a Carla por la API ---------------------------
    await navegar(page, `/pacientes/${ana.id}/pases`);
    await expect(page.getByRole('heading', { name: 'Pases', level: 1 })).toBeVisible();
    await expect(page.locator('app-cabecera-de-persona')).toContainText(ana.apellido);
    const selector = page.getByLabel('Producto');
    const opcion = await selector.locator('option', { hasText: producto }).getAttribute('value');
    await selector.selectOption(opcion ?? '');
    const venta = respuestaDe(page, 'POST', /\/consultorios\/\d+\/pases$/);
    await page.getByRole('button', { name: 'Vender pase' }).click();
    const respuestaVenta = await venta;
    expect(respuestaVenta.status()).toBe(201);
    const paseDeAna = (await respuestaVenta.json()) as { pase: { id: number } };
    await api.exigir('POST', `${base}/pases`, {
      productoId,
      personaId: carla.id,
      idempotencyKey: randomUUID(),
    });

    // --- 3. Asistencia en lote: las dos presentes, cada una consume un credito de su pase -----
    await navegar(page, `/asistencia/${clase.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(clase.titulo);
    const inicio = respuestaDe(page, 'POST', /\/clases\/\d+\/inicio$/);
    await page.getByRole('button', { name: 'Iniciar clase' }).click();
    expect((await inicio).status()).toBe(200);
    for (const persona of [ana, carla]) {
      await page
        .getByRole('row')
        .filter({ hasText: persona.apellido })
        .getByRole('group', { name: /Asistencia de/ })
        .getByLabel('Presente', { exact: true })
        .check();
    }
    const lote = respuestaDe(page, 'POST', LOTE);
    await page.getByRole('button', { name: /Guardar asistencia \(2\)/ }).click();
    const respuestaLote = await lote;
    expect(respuestaLote.status()).toBe(200);
    const cuerpoLote = (await respuestaLote.json()) as {
      exitosos: number;
      items: { resultado?: { consumoDeCredito?: { efecto: string; saldo: number } } }[];
    };
    expect(cuerpoLote.exitosos).toBe(2);
    for (const item of cuerpoLote.items) {
      expect(item.resultado?.consumoDeCredito).toEqual(
        expect.objectContaining({ efecto: 'CONSUMIDO', saldo: 1 }),
      );
    }

    // --- 4 a 6. Derivacion, atencion grupal y cierre de la Sesion, como la profesional --------
    const caso = await casoDe(profesional, ana, oferta.id);
    const sesionId = await atenderYCerrar(
      browser,
      centro,
      clase,
      ana,
      caso,
      'Lumbalgia: seguimiento clinico en la clase',
    );

    // --- 7. La cuenta corriente: solo la venta del pase, la Sesion no devengo nada (U-42) -----
    const deudas = await deudasDe(api, base, ana);
    expect(deudas.filter((d) => d.sesionId === sesionId)).toHaveLength(0);
    expect(deudas).toHaveLength(1);
    const [deudaDelPase] = deudas;
    expect(deudaDelPase).toEqual(
      expect.objectContaining({ estado: 'PENDIENTE', saldo: PRECIO_DEL_PASE }),
    );
    await navegar(page, `/pacientes/${ana.id}/cuenta-corriente`);
    const filaDelPase = page.getByRole('row').filter({ hasText: producto });
    await expect(filaDelPase).toContainText('Venta de pase');
    // El ledger del pase de Ana explica el credito usado.
    const { pase } = await api.exigir<{ pase: { creditosDisponibles: number } }>(
      'GET',
      `${base}/pases/${paseDeAna.pase.id}`,
    );
    expect(pase.creditosDisponibles).toBe(1);

    // --- 8. Cobro en efectivo en la caja de la sede ----------------------------------------
    await dejarLaCajaCerrada(api, centro);
    await abrirLaCaja(api, centro, INICIAL);
    const cobro = await cobrarEnEfectivo(page, ana);
    const pagada = await api.exigir<{ estado: string; saldo: number }>(
      'GET',
      `${base}/obligaciones/${deudaDelPase.id}`,
    );
    expect(pagada).toEqual(expect.objectContaining({ estado: 'PAGADA', saldo: 0 }));
    await navegar(page, '/caja');
    await expect(page.getByRole('heading', { name: 'Caja abierta' })).toBeVisible();
    await expect(dato(page, 'Debería haber en el cajón')).toContainText('16.000,00');
    await expect(movimientoDeCaja(page, `Cobro ${cobro.id}`)).toContainText('+ $');
    expect((await cajaAbierta(api, centro))?.saldoTeorico).toBe(INICIAL + PRECIO_DEL_PASE);
  });

  test('con obra social: la Sesion grupal devenga financiador y coseguro, y el coseguro se cobra', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const { api, profesional, centro } = propio;
    const base = `/api/v1/consultorios/${centro.consultorioId}`;
    const desde = sumarDias(fechaLocal(centro.timezone), -30);

    // --- Sembrado: oferta grupal con practica, convenio con arancel y persona con cobertura ----
    const practicaId = await practicaGlobal(api, 'KIN_SESION');
    const oferta = await crearOferta(api, centro, {
      nombre: `Rehabilitacion grupal OS E2E ${nonce()}`,
      habilitarProfesional: false,
      extra: {
        modalidad: 'GRUPAL',
        capacidad: 8,
        requiereProfesional: false,
        generaRegistroClinico: true,
        admiteObraSocial: true,
        precioBase: IMPORTES.total,
        moneda: 'ARS',
      },
    });
    await api.exigir('PUT', `${base}/ofertas/${oferta.id}/practicas`, {
      practicaIds: [practicaId],
      practicaPrincipalId: practicaId,
      expectedVersion: oferta.version,
    });
    const financiador = await crearFinanciador(api, desde);
    const convenio = await crearConvenio(api, centro, financiador, desde);
    await api.exigir('POST', `${base}/convenios/${convenio.id}/aranceles`, {
      practicaId,
      importeTotal: IMPORTES.total,
      importeFinanciador: IMPORTES.financiador,
      coseguro: IMPORTES.coseguro,
      vigenciaDesde: desde,
    });
    const dora = await crearPersona(api, { nombre: 'Dora' });
    await darCobertura(api, dora, financiador, desde);

    // --- Clase, inscripcion y asistencia por la API (las pantallas las recorre el otro test) ---
    const clase = await programarClase(api, centro, oferta.id, 4);
    const { inscripcion } = await api.exigir<{ inscripcion: { id: number } }>(
      'POST',
      `${base}/clases/${clase.id}/inscripciones`,
      { personaId: dora.id, aceptaListaEspera: false, idempotencyKey: randomUUID() },
    );
    await api.exigir('POST', `${base}/clases/${clase.id}/inicio`);
    await api.exigir('POST', `${base}/clases/${clase.id}/asistencias/lote`, {
      items: [{ inscripcionId: inscripcion.id, resultado: 'PRESENTE' }],
    });

    // --- Derivacion, atencion grupal y cierre, como la profesional ---------------------------
    const caso = await casoDe(profesional, dora, oferta.id);
    const sesionId = await atenderYCerrar(
      browser,
      centro,
      clase,
      dora,
      caso,
      'Gonartrosis: seguimiento clinico en la clase',
    );

    // --- La deuda: coseguro de la persona y parte del financiador, las dos de esta Sesion -----
    const deudas = await deudasDe(api, base, dora);
    expect(deudas.map((d) => d.concepto)).toEqual(['COSEGURO']);
    const [coseguro] = deudas;
    expect(coseguro).toEqual(
      expect.objectContaining({ sesionId, estado: 'PENDIENTE', saldo: IMPORTES.coseguro }),
    );
    const hoy = fechaLocal(centro.timezone);
    const elegibles = await api.exigir<Obligacion[]>(
      'GET',
      `${base}/prestaciones-elegibles?financiadorId=${financiador.id}&desde=${sumarDias(hoy, -1)}&hasta=${sumarDias(hoy, 1)}`,
    );
    expect(elegibles.find((d) => d.sesionId === sesionId)).toEqual(
      expect.objectContaining({ personaId: dora.id, saldo: IMPORTES.financiador }),
    );

    await ingresar(page, centro);
    await navegar(page, `/pacientes/${dora.id}/cuenta-corriente`);
    const tabla = page.getByRole('region', { name: 'Deudas de la persona' });
    const fila = tabla.getByRole('row').filter({ hasText: 'Coseguro' });
    await expect(fila).toContainText(`Convenio ${convenio.nombre}`);
    await expect(fila).toContainText('3.000,00');
    await expect(tabla.getByText('A cargo de la obra social')).toHaveCount(0);

    // --- Cobro del coseguro en efectivo -----------------------------------------------------
    await dejarLaCajaCerrada(api, centro);
    await abrirLaCaja(api, centro, INICIAL);
    const cobro = await cobrarEnEfectivo(page, dora);
    const pagado = await api.exigir<{ estado: string; saldo: number }>(
      'GET',
      `${base}/obligaciones/${coseguro.id}`,
    );
    expect(pagado).toEqual(expect.objectContaining({ estado: 'PAGADA', saldo: 0 }));
    await navegar(page, '/caja');
    await expect(dato(page, 'Debería haber en el cajón')).toContainText('4.000,00');
    await expect(movimientoDeCaja(page, `Cobro ${cobro.id}`)).toContainText('+ $');
  });
});

// ---------------------------------------------------------------------------------------------

/**
 * Programa una clase de la oferta con `cupo` lugares en el primer dia de {@link DIAS_DE_LA_CLASE}
 * que la sede admite (un feriado nacional la cierra). Sin profesional ni espacio: no compite con
 * nada del centro.
 */
async function programarClase(
  api: ApiAkine,
  centro: Centro,
  ofertaId: number,
  cupo: number,
): Promise<Clase> {
  const titulo = `Clase del circuito ${nonce()}`;
  const minuto = String(Math.floor(Math.random() * 6) * 10).padStart(2, '0');
  let ultimo = '';
  for (let dias = DIAS_DE_LA_CLASE.desde; dias <= DIAS_DE_LA_CLASE.hasta; dias++) {
    const fecha = fechaLocal(centro.timezone, dias);
    const respuesta = await api.pedir(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/clases/ofertas/${ofertaId}`,
      {
        titulo,
        capacidad: cupo,
        inicio: instanteEnZona(fecha, `11:${minuto}`, centro.timezone),
        fin: instanteEnZona(fecha, `12:${minuto}`, centro.timezone),
        idempotencyKey: randomUUID(),
      },
    );
    if (respuesta.ok()) {
      return { id: ((await respuesta.json()) as { id: number }).id, titulo };
    }
    ultimo = `${fecha}: ${respuesta.status()} ${await respuesta.text()}`;
  }
  throw new Error(`No se pudo programar la clase en ningun dia del bloque. Ultimo: ${ultimo}`);
}

/** Inscribe desde el detalle de la clase, buscando a la persona en el padron. */
async function inscribir(page: Page, persona: Persona): Promise<void> {
  await page.getByLabel('Buscar en el padron: documento, apellido o nombre').fill(persona.apellido);
  await page.getByRole('button', { name: `${persona.apellido}, ${persona.nombre}` }).click();
  await page.getByRole('button', { name: 'Inscribir', exact: true }).click();
}

/** La profesional abre la historia de la persona y un Caso de la oferta. Devuelve el Caso. */
async function casoDe(profesional: ApiAkine, persona: Persona, ofertaId: number): Promise<number> {
  const historia = await exigirCon<{ id: number }>(
    profesional,
    'PUT',
    `/api/v1/historias-clinicas/por-persona/${persona.id}`,
    undefined,
    JUSTIFICACION,
  );
  const caso = await exigirCon<{ id: number }>(
    profesional,
    'POST',
    `/api/v1/historias-clinicas/${historia.id}/casos`,
    { ofertaId, diagnosticoPresuntivo: 'Diagnostico sintetico del circuito de F9' },
    JUSTIFICACION,
  );
  return caso.id;
}

/**
 * La profesional, en su propio navegador: panel de atencion clinica de la clase → "Derivar a un
 * caso" de la participante, al Caso recien abierto (AKINE-08.04) → "Iniciar atencion" → la Sesion
 * abre desde la derivacion, con su Caso → la cierra con asistencia. Devuelve el id de la Sesion.
 */
async function atenderYCerrar(
  browser: Browser,
  centro: Centro,
  clase: Clase,
  persona: Persona,
  casoId: number,
  motivoDeDerivacion: string,
): Promise<number> {
  const contexto = await browser.newContext();
  try {
    const pagina = await contexto.newPage();
    await ingresarAlCentro(pagina, centro.emailProfesional, centro);
    await navegar(pagina, `/atencion/clases/${clase.id}`);
    await expect(pagina.getByRole('heading', { level: 1 })).toContainText(clase.titulo);
    const fila = pagina.getByRole('row').filter({ hasText: persona.apellido });
    await expect(fila).toContainText('Presente');

    // Derivar por pantalla: el unico Caso activo queda elegido.
    await fila.getByRole('button', { name: /Derivar a un caso/ }).click();
    const tarjeta = pagina.getByRole('region', { name: /^Derivar a .* a un caso clínico$/ });
    await expect(tarjeta.getByRole('radio', { name: /Caso clínico 1/ })).toBeChecked();
    await tarjeta
      .getByRole('textbox', { name: /Motivo de la derivación/ })
      .fill(motivoDeDerivacion);
    const derivar = respuestaDe(pagina, 'POST', /\/inscripciones\/\d+\/derivaciones$/);
    await tarjeta.getByRole('button', { name: 'Derivar al caso' }).click();
    let derivada = await derivar;
    if (derivada.status() === 403) {
      await pagina
        .getByRole('textbox', { name: 'Motivo del acceso' })
        .fill(JUSTIFICACION['X-Justificacion-Acceso']);
      const reintento = respuestaDe(pagina, 'POST', /\/inscripciones\/\d+\/derivaciones$/);
      await pagina.getByRole('button', { name: 'Declarar y seguir' }).click();
      derivada = await reintento;
    }
    expect(derivada.status()).toBe(201);
    expect(((await derivada.json()) as { casoClinicoId: number }).casoClinicoId).toBe(casoId);
    await expect(fila).toContainText('Derivada al caso clínico 1');

    const inicio = respuestaDe(pagina, 'POST', /\/inscripciones\/\d+\/atencion-clinica$/);
    await fila.getByRole('button', { name: /Iniciar atención/ }).click();
    let respuesta = await inicio;
    if (respuesta.status() === 403) {
      // Sin relacion asistencial el backend pide el motivo del acceso (DP-03).
      await pagina
        .getByRole('textbox', { name: 'Motivo del acceso' })
        .fill(JUSTIFICACION['X-Justificacion-Acceso']);
      const reintento = respuestaDe(pagina, 'POST', /\/inscripciones\/\d+\/atencion-clinica$/);
      await pagina.getByRole('button', { name: 'Declarar y seguir' }).click();
      respuesta = await reintento;
    }
    expect(respuesta.status()).toBe(201);
    const atencion = (await respuesta.json()) as { sesionId: number; casoId: number };
    expect(atencion.casoId).toBe(casoId);

    await expect(pagina).toHaveURL(new RegExp(`/atencion/sesiones/${atencion.sesionId}$`));
    await expect(pagina.getByRole('heading', { name: 'Atención en curso' })).toBeVisible();
    await pagina.getByRole('radio', { name: 'Vino a la sesión' }).check();
    await pagina.getByLabel('Nota de cierre').fill('Trabajo grupal bien tolerado, sin dolor.');
    const cierre = respuestaDe(pagina, 'POST', /\/sesiones\/\d+\/cierre$/);
    await pagina.getByRole('button', { name: 'Cerrar la atención' }).click();
    expect((await cierre).status()).toBe(200);
    await expect(pagina.getByRole('heading', { name: 'Atención cerrada' })).toBeVisible();
    return atencion.sesionId;
  } finally {
    await contexto.close();
  }
}

/** Deudas de la persona en la sede, como las lee la cuenta corriente. */
function deudasDe(api: ApiAkine, base: string, persona: Persona): Promise<DeudaDeLaPersona[]> {
  return api.exigir('GET', `${base}/obligaciones?personaId=${persona.id}`);
}

/** Cobra en efectivo el saldo entero de la unica deuda de la persona, desde la pantalla. */
async function cobrarEnEfectivo(
  page: Page,
  persona: Persona,
): Promise<{ id: number; comprobanteNumero: number }> {
  await navegar(page, `/pacientes/${persona.id}/cuenta-corriente/cobrar`);
  await expect(page.getByRole('heading', { name: 'Registrar un cobro', level: 1 })).toBeVisible();
  await page.getByRole('checkbox', { name: /saldo/ }).check();
  await page.getByLabel('Medio de pago').selectOption({ label: 'Efectivo' });
  await page.getByRole('button', { name: 'Completar con el total imputado' }).click();
  const alta = respuestaDe(page, 'POST', /\/cobros$/);
  await page.getByRole('button', { name: 'Registrar el cobro' }).click();
  const respuesta = await alta;
  expect(respuesta.status(), await respuesta.text()).toBe(201);
  await expect(page.getByRole('heading', { name: 'Cobro registrado' })).toBeVisible();
  return (await respuesta.json()) as { id: number; comprobanteNumero: number };
}
