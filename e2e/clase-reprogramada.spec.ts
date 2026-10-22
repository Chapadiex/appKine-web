import { test } from '@playwright/test';

import { ingresar, navegar, respuestaDe } from './support/agenda-real';
import {
  CentroPropio,
  cerrarCentroPropio,
  expect,
  sembrarCentroPropio,
} from './support/centro-propio';
import { esperarProblema } from './support/cuentas';
import { ClaseSembrada, claseConInscriptos, instanteEnZona } from './support/sembrado-asistencia';
import { sumarDias } from './support/sembrado';

/**
 * E2E de "Reprogramar" una clase en `/clases/:id` (F9, AKINE-08.01) contra el backend REAL.
 *
 * <p>Una clase futura con dos inscriptas, sembrada por la API sobre un centro propio
 * (`support/centro-propio.ts`: el bloque de dias de `flujo-clases` es del centro compartido y la
 * reprogramacion mueve la clase fuera de el). Por pantalla: mover la clase al dia siguiente, en
 * otro horario y con otro cupo. Lo que se afirma es que es LA MISMA clase —mismo id, las mismas
 * inscriptas con su lugar— en el horario nuevo de la sede, y que el historial registra el cambio.
 *
 * <p>Despues, la carrera de dos operadores: otro reprograma por la API mientras la pantalla muestra
 * la version vieja, y guardar desde la pantalla no pisa ese cambio.
 */
test.describe.configure({ mode: 'default' });

interface ClaseLeida {
  readonly id: number;
  readonly inicio: string;
  readonly fin: string;
  readonly capacidad: number;
  readonly version: number;
  readonly estado: string;
}

test.describe('Reprogramar una clase contra el backend real', () => {
  let propio: CentroPropio;
  let clase: ClaseSembrada;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    propio = await sembrarCentroPropio('reprograma');
    clase = await claseConInscriptos(propio.api, propio.centro, 12, 2);
  });

  test.afterAll(async () => {
    await cerrarCentroPropio(propio);
  });

  test('mover la clase al dia siguiente conserva a sus inscriptas y lo deja en el historial', async ({
    page,
  }) => {
    const { api, centro } = propio;
    const zona = centro.timezone;
    const ruta = `/api/v1/consultorios/${centro.consultorioId}/clases/${clase.id}`;
    const nuevaFecha = sumarDias(clase.fecha, 1);

    await ingresar(page, centro);
    await navegar(page, `/clases/${clase.id}`);
    await expect(page.getByRole('heading', { name: clase.titulo, level: 1 })).toBeVisible();
    const inscriptas = page.getByRole('region', { name: 'Inscriptos con lugar' });
    for (const { persona } of clase.inscripciones) {
      await expect(
        inscriptas.getByRole('row', { name: new RegExp(persona.apellido) }),
      ).toBeVisible();
    }

    // --- Reprogramar ---------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Reprogramar' }).click();
    const formulario = page.getByRole('form', { name: 'Reprogramar la clase' });
    await expect(formulario.getByLabel('Fecha')).toHaveValue(clase.fecha);
    await formulario.getByLabel('Fecha').fill(nuevaFecha);
    await formulario.getByLabel('Hora de inicio').fill('16:00');
    await formulario.getByLabel('Hora de fin').fill('17:30');
    await formulario.getByLabel('Cupo').fill('4');
    const reprogramacion = respuestaDe(page, 'POST', /\/clases\/\d+\/reprogramacion$/);
    await formulario.getByRole('button', { name: 'Guardar el cambio' }).click();
    const respuesta = await reprogramacion;
    expect(respuesta.status(), await respuesta.text()).toBe(200);

    await expect(page.locator('#aviso-clase')).toHaveText(
      'Clase reprogramada. Si cambio el horario, los inscriptos reciben un aviso.',
    );
    await expect(page.locator('.datos-en-linea')).toContainText('16:00 a 17:30');
    await expect(
      page.locator('section', { has: page.getByRole('heading', { name: 'Historial' }) }),
    ).toContainText('Reprogramada');
    for (const { persona } of clase.inscripciones) {
      await expect(
        inscriptas.getByRole('row', { name: new RegExp(persona.apellido) }),
      ).toBeVisible();
    }

    // --- Lo que quedo en el servidor ---------------------------------------------------------
    const leida = await api.exigir<ClaseLeida>('GET', ruta);
    expect(leida).toMatchObject({ id: clase.id, capacidad: 4, estado: 'PROGRAMADA' });
    expect(Date.parse(leida.inicio)).toBe(Date.parse(instanteEnZona(nuevaFecha, '16:00', zona)));
    expect(Date.parse(leida.fin)).toBe(Date.parse(instanteEnZona(nuevaFecha, '17:30', zona)));
    const inscripciones = await api.exigir<{ inscripcion: { id: number; estado: string } }[]>(
      'GET',
      `${ruta}/inscripciones`,
    );
    expect(
      inscripciones
        .filter((p) => p.inscripcion.estado === 'RESERVADA')
        .map((p) => p.inscripcion.id)
        .sort(),
    ).toEqual(clase.inscripciones.map((i) => i.inscripcionId).sort());
  });

  test('guardar sobre una version vieja no pisa la reprogramacion de otro operador', async ({
    page,
  }) => {
    const { api, centro } = propio;
    const zona = centro.timezone;
    const ruta = `/api/v1/consultorios/${centro.consultorioId}/clases/${clase.id}`;

    await ingresar(page, centro);
    await navegar(page, `/clases/${clase.id}`);
    await expect(page.getByRole('heading', { name: clase.titulo, level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Reprogramar' }).click();
    const formulario = page.getByRole('form', { name: 'Reprogramar la clase' });
    const fecha = await formulario.getByLabel('Fecha').inputValue();

    // Otro operador la corre a la tarde mientras la pantalla tiene la version anterior.
    const antes = await api.exigir<ClaseLeida>('GET', ruta);
    const delOtro = {
      inicio: instanteEnZona(fecha, '18:00', zona),
      fin: instanteEnZona(fecha, '19:00', zona),
    };
    await api.exigir('POST', `${ruta}/reprogramacion`, {
      ...delOtro,
      capacidad: antes.capacidad,
      version: antes.version,
    });

    await formulario.getByLabel('Hora de inicio').fill('08:00');
    await formulario.getByLabel('Hora de fin').fill('09:00');
    const reprogramacion = respuestaDe(page, 'POST', /\/clases\/\d+\/reprogramacion$/);
    await formulario.getByRole('button', { name: 'Guardar el cambio' }).click();
    await esperarProblema(
      await reprogramacion,
      409,
      'https://akine.app/problems/concurrent-modification',
    );
    await expect(
      page.getByRole('alert').filter({ hasText: 'No se pudo completar la operación' }),
    ).toBeVisible();

    const despues = await api.exigir<ClaseLeida>('GET', ruta);
    expect(Date.parse(despues.inicio)).toBe(Date.parse(delOtro.inicio));
    expect(Date.parse(despues.fin)).toBe(Date.parse(delOtro.fin));
  });
});
