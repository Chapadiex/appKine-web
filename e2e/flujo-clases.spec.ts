import { expect, ingresar, navegar, problemaDe, respuestaDe, test } from './support/agenda-real';
import {
  DIAS,
  Oferta,
  Persona,
  crearOferta,
  crearPersona,
  diaDeTrabajo,
  sumarDias,
  uriDeProblema,
} from './support/sembrado';

/**
 * E2E de las clases grupales (F9, AKINE-08.01 y 08.02) contra el backend REAL:
 * programar la clase por pantalla, eligiendo el box → inscribir hasta llenar el cupo → la tercera persona choca con
 * `clase-completa` y entra a la lista de espera → la baja de una inscripta promueve a la que
 * esperaba → la clase aparece en la semana y en la recepcion del dia.
 *
 * <p>La clase ocupa al profesional del centro de 20:00 a 21:00 de su propio bloque de dias
 * ({@link DIAS}.clases): ningun otro spec reserva ahi. El dia se elige con una oferta individual
 * auxiliar, para esquivar feriados igual que el resto de los flujos.
 *
 * <p>El box es propio del spec y es el unico habilitado para la oferta: elegirlo por pantalla
 * prueba que `espacioId` viaja y que la clase vuelve con `espacioNombre` y `profesionalNombre`
 * (appKine-api #128), sin lecturas extra para resolverlos.
 */

const CUPO = 2;

interface Participante {
  readonly inscripcion: { readonly personaId: number; readonly estado: string };
}

interface Cupos {
  readonly ocupados: number;
  readonly enEspera: number;
  readonly disponibles: number;
}

test.describe('Clases grupales contra el backend real', () => {
  let oferta: Oferta;
  let personas: Persona[];
  let fecha: string;
  let box: { readonly id: number; readonly nombre: string };
  /** Clase creada por el test. Se cancela al final aunque falle: un reintento choca con ella. */
  let claseCreada: number | null = null;

  test.beforeEach(async ({ page, api, centro }) => {
    const auxiliar = await crearOferta(api, centro);
    ({ fecha } = await diaDeTrabajo(api, centro, auxiliar.id, DIAS.clases));
    // Un intento anterior que murio sin limpiar dejaria al profesional ocupado: el bloque es de
    // este spec, asi que toda clase viva en el se cancela antes de empezar.
    const vivas = await api.exigir<{ id: number; estado: string }[]>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/clases?desde=${fecha}T00:00:00Z&hasta=${sumarDias(fecha, 2)}T00:00:00Z`,
    );
    for (const viva of vivas.filter((c) => c.estado === 'PROGRAMADA')) {
      await api.exigir(
        'POST',
        `/api/v1/consultorios/${centro.consultorioId}/clases/${viva.id}/cancelacion`,
        { motivo: 'Limpieza de un intento anterior del E2E' },
      );
    }
    oferta = await crearOferta(api, centro, {
      nombre: `Pilates E2E ${Date.now()}`,
      duracionMinutos: 60,
      extra: { modalidad: 'GRUPAL', capacidad: 6 },
    });
    const nombreDelBox = `Sala E2E ${Date.now()}`;
    const { id: espacioId } = await api.exigir<{ id: number }>(
      'POST',
      `/api/v1/organizations/${centro.organizationId}/consultorios/${centro.consultorioId}/espacios`,
      { name: nombreDelBox, capacidad: 6, tipo: 'SALA_GRUPAL' },
    );
    box = { id: espacioId, nombre: nombreDelBox };
    await api.exigir(
      'PUT',
      `/api/v1/consultorios/${centro.consultorioId}/ofertas/${oferta.id}/habilitaciones/espacios`,
      { expectedVersion: oferta.version, ids: [box.id] },
    );
    personas = [
      await crearPersona(api, { nombre: 'Ana' }),
      await crearPersona(api, { nombre: 'Bruno' }),
      await crearPersona(api, { nombre: 'Carla' }),
    ];
    await ingresar(page, centro);
  });

  test.afterEach(async ({ api, centro }) => {
    if (claseCreada !== null) {
      await api.pedir(
        'POST',
        `/api/v1/consultorios/${centro.consultorioId}/clases/${claseCreada}/cancelacion`,
        { motivo: 'Limpieza del E2E' },
      );
      claseCreada = null;
    }
    // El box es del spec: se da de baja para no dejarlo en la sede de los demas flujos.
    await api.pedir(
      'POST',
      `/api/v1/organizations/${centro.organizationId}/consultorios/${centro.consultorioId}/espacios/${box.id}/deactivate`,
      { reason: 'Limpieza del E2E de clases' },
    );
  });

  test('alta → cupo lleno → lista de espera → la baja promueve a quien esperaba', async ({
    page,
    api,
    centro,
  }) => {
    // 1. Programar la clase por pantalla.
    await navegar(page, `/clases/nueva?fecha=${fecha}`);
    await expect(page.getByRole('heading', { name: 'Programar clase', level: 1 })).toBeVisible();
    const habilitaciones = respuestaDe(page, 'GET', /\/habilitaciones$/);
    await page.getByLabel('Oferta grupal').selectOption({ label: oferta.nombre });
    expect((await habilitaciones).status()).toBe(200);
    await page.getByLabel('Profesional a cargo').selectOption({ label: centro.profesional.nombre });
    await page.getByLabel('Box').selectOption({ label: box.nombre });
    await page.getByLabel('Hora de inicio').fill('20:00');
    await page.getByLabel('Hora de fin').fill('21:00');
    await page.getByLabel('Cupo').fill(String(CUPO));
    const programada = respuestaDe(page, 'POST', /\/clases\/ofertas\/\d+$/);
    await page.getByRole('button', { name: 'Programar clase' }).click();
    const respuesta = await programada;
    expect(respuesta.status(), await respuesta.text()).toBe(201);
    const programadaComo = (await respuesta.json()) as {
      id: number;
      espacioId?: number;
      espacioNombre?: string;
      profesionalNombre?: string;
      ofertaNombre?: string;
    };
    const claseId = programadaComo.id;
    expect(programadaComo).toEqual(
      expect.objectContaining({
        espacioId: box.id,
        espacioNombre: box.nombre,
        ofertaNombre: oferta.nombre,
        profesionalNombre: centro.profesional.nombre,
      }),
    );
    claseCreada = claseId;

    await expect(page).toHaveURL(new RegExp(`/clases/${claseId}$`));
    await expect(page.getByRole('heading', { name: oferta.nombre, level: 1 })).toBeVisible();
    await expect(page.getByText('Programada', { exact: true })).toBeVisible();
    const datos = page.getByRole('region', { name: 'La clase', exact: true });
    await expect(datos).toContainText(box.nombre);
    await expect(datos).toContainText(centro.profesional.nombre);

    // 2. Inscribir hasta llenar el cupo.
    for (const persona of personas.slice(0, CUPO)) {
      await inscribir(persona);
      await expect(
        page.getByText(`${persona.apellido}, ${persona.nombre} quedo inscripta con lugar.`),
      ).toBeVisible();
    }
    const llena = await cuposDe(claseId);
    expect(llena).toEqual(expect.objectContaining({ ocupados: CUPO, disponibles: 0, enEspera: 0 }));

    // 3. La tercera choca con el cupo y entra a la lista de espera desde el mismo aviso.
    const tercera = personas[2];
    const rechazo = respuestaDe(page, 'POST', /\/inscripciones$/);
    await inscribir(tercera);
    const completa = await rechazo;
    expect(completa.status()).toBe(409);
    expect((await problemaDe(completa)).type).toBe(uriDeProblema('clase-completa'));
    await expect(page.getByText(`Ocupados ${CUPO} de ${CUPO}.`)).toBeVisible();
    await page.getByRole('button', { name: 'Anotar en la lista de espera' }).click();
    await expect(
      page.getByText(
        `${tercera.apellido}, ${tercera.nombre} quedo en la lista de espera, posicion 1.`,
      ),
    ).toBeVisible();
    await expect(page.getByRole('list', { name: /Lista de espera/ })).toContainText(
      `${tercera.apellido}, ${tercera.nombre} — posicion 1`,
    );
    expect(await cuposDe(claseId)).toEqual(
      expect.objectContaining({ ocupados: CUPO, enEspera: 1 }),
    );

    // 4. La baja de la primera libera el lugar y la tercera entra sola.
    const primera = personas[0];
    await page
      .getByRole('button', { name: `Dar de baja a ${primera.apellido}, ${primera.nombre}` })
      .click();
    await page.getByLabel('Motivo de la baja').fill('No puede venir esa semana');
    const baja = respuestaDe(page, 'POST', /\/inscripciones\/\d+\/cancelacion$/);
    await page.getByRole('button', { name: 'Dar de baja', exact: true }).click();
    expect((await baja).status()).toBe(200);
    await expect(
      page.getByText(
        `${tercera.apellido}, ${tercera.nombre} entro desde la lista de espera y recibe un aviso.`,
      ),
    ).toBeVisible();

    const participantes = await api.exigir<Participante[]>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/clases/${claseId}/inscripciones`,
    );
    const estadoDe = (persona: Persona) =>
      participantes.find((p) => p.inscripcion.personaId === persona.id)?.inscripcion.estado;
    expect(estadoDe(primera)).toBe('CANCELADA');
    expect(estadoDe(personas[1])).toBe('RESERVADA');
    expect(estadoDe(tercera)).toBe('RESERVADA');
    expect(await cuposDe(claseId)).toEqual(
      expect.objectContaining({ ocupados: CUPO, disponibles: 0, enEspera: 0 }),
    );

    // 5. La clase aparece en la semana y en la recepcion de ese dia (agenda unificada).
    await navegar(page, `/clases?semana=${fecha}`);
    await expect(
      page.getByRole('link', { name: new RegExp(`Ver clase ${oferta.nombre}`) }),
    ).toBeVisible();
    await expect(page.getByText(`${centro.profesional.nombre} · ${box.nombre}`)).toBeVisible();
    await navegar(page, `/agenda/recepcion?fecha=${fecha}`);
    const delDia = page.getByRole('region', { name: 'Clases grupales del día' });
    await expect(delDia).toContainText(oferta.nombre);
    await expect(delDia).toContainText(`${CUPO} de ${CUPO} lugares ocupados`);

    // 6. Cancelar la clase con motivo: libera al profesional y cancela las inscripciones.
    await delDia.getByRole('link', { name: new RegExp(`Ver clase ${oferta.nombre}`) }).click();
    await expect(page.getByRole('heading', { name: oferta.nombre, level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar la clase' }).click();
    await page.getByLabel('Motivo de la cancelacion').fill('Se suspende por mantenimiento');
    const cancelada = respuestaDe(page, 'POST', /\/clases\/\d+\/cancelacion$/);
    await page.getByRole('button', { name: 'Cancelar la clase' }).click();
    expect((await cancelada).status()).toBe(200);
    await expect(page.getByText(/^Clase cancelada\./)).toBeVisible();
    await expect(page.getByText('Cancelada', { exact: true })).toBeVisible();
    claseCreada = null;

    async function inscribir(persona: Persona): Promise<void> {
      await page
        .getByLabel('Buscar en el padron: documento, apellido o nombre')
        .fill(persona.apellido);
      await page.getByRole('button', { name: `${persona.apellido}, ${persona.nombre}` }).click();
      await page.getByRole('button', { name: 'Inscribir', exact: true }).click();
    }

    async function cuposDe(id: number): Promise<Cupos> {
      return api.exigir<Cupos>(
        'GET',
        `/api/v1/consultorios/${centro.consultorioId}/clases/${id}/cupos`,
      );
    }
  });
});
