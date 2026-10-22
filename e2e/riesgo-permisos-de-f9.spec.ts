import { Page, test } from '@playwright/test';

import {
  CentroPropio,
  cerrarCentroPropio,
  expect,
  sembrarCentroPropio,
} from './support/centro-propio';
import { ApiAkine, Persona, crearPersona, deAUnLogin, uriDeProblema } from './support/sembrado';
import { ClaseSembrada, claseConInscriptos } from './support/sembrado-asistencia';
import { colaboradoraActiva, ingresarAlCentro } from './support/sembrado-pantallas-098';

/**
 * E2E de los permisos de las pantallas de F9 por ROL, contra el backend real (AKINE-09.02).
 *
 * <p>La matriz le niega al `PROFESIONAL` el catalogo de productos y los pases ("No por defecto" en
 * las filas economicas de la matriz §2: `producto:read` y `pase:read` no son suyos), y el
 * `ADMINISTRATIVO` no tiene `sesion:register`, que es para lo unico que sirve el panel de atencion
 * clinica de una clase. Ningun spec lo recorria con cuentas de esos roles. Lo que se afirma:
 *
 * <ol>
 *   <li>el backend le niega a la profesional productos y pases con `forbidden`, sin depender de la
 *       pantalla;</li>
 *   <li>cada rol termina en `/sin-permiso` en la pantalla que no le corresponde —no en una pantalla
 *       que se llena de errores—, y el menu no se la ofrece;</li>
 *   <li>y como control, cada uno SI entra a lo que su rol tiene: sin eso, un `/sin-permiso`
 *       universal pasaria igual.</li>
 * </ol>
 *
 * <p>Centro propio (`support/centro-propio.ts`): suma una administrativa, y sobre el centro
 * compartido eso acerca al tope de miembros del plan BASICO.
 */
test.describe.configure({ mode: 'default' });

/** Bloque de dias propio, lejos de los de `DIAS` en `support/sembrado.ts`. */
const DIA_PERMISOS_F9 = 171;

test.describe('Permisos de las pantallas de F9 por rol contra el backend real', () => {
  let propio: CentroPropio;
  let clase: ClaseSembrada;
  let persona: Persona;
  let emailAdministrativa: string;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    propio = await sembrarCentroPropio('permisos-f9');
    clase = await claseConInscriptos(propio.api, propio.centro, DIA_PERMISOS_F9, 1);
    persona = await crearPersona(propio.api);
    ({ email: emailAdministrativa } = await colaboradoraActiva(
      propio.api,
      propio.centro,
      'ADMINISTRATIVO',
    ));
  });

  test.afterAll(async () => {
    await cerrarCentroPropio(propio);
  });

  test('PROFESIONAL: el backend le niega productos y pases, y la pantalla no los abre', async ({
    page,
  }) => {
    const { profesional, centro } = propio;
    const sede = `/api/v1/consultorios/${centro.consultorioId}`;
    await esperarForbidden(profesional, `${sede}/productos`);
    await esperarForbidden(profesional, `${sede}/personas/${persona.id}/pases`);

    await deAUnLogin(() => ingresarAlCentro(page, centro.emailProfesional, centro));

    for (const ruta of ['/productos', `/pacientes/${persona.id}/pases`]) {
      await esperarSinPermiso(page, ruta, centro.nombreCentro);
    }
    await expect(
      page.getByRole('link', { name: 'Productos de pack', includeHidden: true, exact: true }),
    ).toHaveCount(0);

    // Control: lo que su rol si tiene abre su pantalla.
    await irA(page, `/asistencia/${clase.id}`);
    await expect(page.getByRole('heading', { name: /^Asistencia: /, level: 1 })).toBeVisible();
    await irA(page, `/atencion/clases/${clase.id}`);
    await expect(
      page.getByRole('heading', { name: /^Atención clínica: /, level: 1 }),
    ).toBeVisible();
  });

  test('ADMINISTRATIVO: la atencion clinica de la clase no se le abre ni se le ofrece', async ({
    page,
  }) => {
    const { centro } = propio;
    await deAUnLogin(() => ingresarAlCentro(page, emailAdministrativa, centro));

    await esperarSinPermiso(page, `/atencion/clases/${clase.id}`, centro.nombreCentro);

    // La clase y la asistencia si son suyas, y ninguna de las dos le ofrece la atencion clinica.
    await irA(page, `/clases/${clase.id}`);
    await expect(page.getByRole('link', { name: 'Tomar asistencia' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Atencion clinica' })).toHaveCount(0);
    await irA(page, `/asistencia/${clase.id}`);
    await expect(page.getByRole('heading', { name: /^Asistencia: /, level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Atención clínica de la clase' })).toHaveCount(0);

    // Control: productos y pases son de su rol.
    await irA(page, '/productos');
    await expect(
      page.getByRole('heading', { name: 'Productos de pack y abonos', level: 1 }),
    ).toBeVisible();
    await irA(page, `/pacientes/${persona.id}/pases`);
    await expect(page).toHaveURL(new RegExp(`/pacientes/${persona.id}/pases$`));
  });
});

/** Navega dentro de la SPA, sin recargar: la sesion vive en memoria. */
async function irA(page: Page, ruta: string): Promise<void> {
  await page.evaluate((destino) => {
    history.pushState(null, '', destino);
    dispatchEvent(new PopStateEvent('popstate', { state: null }));
  }, ruta);
}

async function esperarSinPermiso(page: Page, ruta: string, nombreCentro: string): Promise<void> {
  await irA(page, ruta);
  await expect(page, `${ruta} no se le abre`).toHaveURL(/\/sin-permiso$/);
  await expect(
    page.getByRole('heading', { name: 'No tenés permiso para esta pantalla', level: 1 }),
  ).toBeVisible();
  // En `main`: la barra superior (UX-01) tambien dice el centro activo.
  await expect(page.getByRole('main').getByText(nombreCentro, { exact: true })).toBeVisible();
}

async function esperarForbidden(api: ApiAkine, ruta: string): Promise<void> {
  const respuesta = await api.pedir('GET', ruta);
  expect(respuesta.status(), `GET ${ruta}: ${await respuesta.text()}`).toBe(403);
  expect(((await respuesta.json()) as { type: string }).type).toBe(uriDeProblema('forbidden'));
}
