import { Page, test } from '@playwright/test';

import {
  CentroPropio,
  cerrarCentroPropio,
  expect,
  sembrarCentroPropio,
} from './support/centro-propio';
import { ApiAkine, deAUnLogin, uriDeProblema } from './support/sembrado';
import { colaboradoraActiva, ingresarAlCentro } from './support/sembrado-pantallas-098';

/**
 * E2E de DP-36 (U-07 y U-08, contrato 0.130.0) por ROL, contra el backend real.
 *
 * <p>Hasta DP-36 la configuracion economica (financiadores, planes, convenios, aranceles) y el
 * catalogo clinico se leian por pertenencia, asi que una membership `PACIENTE` los leia enteros.
 * Ahora la lectura exige `convenio:read` y `catalogo:read`, que tiene el personal y no el paciente.
 * Lo que se afirma:
 *
 * <ol>
 *   <li>el backend le niega al PACIENTE esas lecturas con `forbidden`, sin depender de la pantalla
 *       —financiadores, convenios de la sede, catalogo clinico y tipos de medicion—;</li>
 *   <li>la pantalla no le abre Contratacion ni Catalogo por URL (`/sin-permiso`) y el menu no se
 *       las ofrece;</li>
 *   <li>y como control, la PROFESIONAL si entra a las dos y ve el menu: sin eso, un `/sin-permiso`
 *       universal pasaria igual. Que no vea "Dar de alta" en el catalogo es `catalogo:manage`.</li>
 * </ol>
 *
 * <p>Centro propio (`support/centro-propio.ts`): suma una cuenta con rol PACIENTE a la sede.
 */
test.describe.configure({ mode: 'default' });

test.describe('Permisos de convenios y catalogo por rol contra el backend real (DP-36)', () => {
  let propio: CentroPropio;
  let emailPaciente: string;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    propio = await sembrarCentroPropio('permisos-dp36');
    ({ email: emailPaciente } = await colaboradoraActiva(propio.api, propio.centro, 'PACIENTE'));
  });

  test.afterAll(async () => {
    await cerrarCentroPropio(propio);
  });

  test('PACIENTE: el backend le niega convenios y catalogo, y la pantalla no los abre', async ({
    page,
  }) => {
    const { centro } = propio;
    const paciente = await ApiAkine.como(emailPaciente, { organizationId: centro.organizationId });
    try {
      for (const ruta of [
        '/api/v1/financiadores',
        `/api/v1/consultorios/${centro.consultorioId}/convenios`,
        '/api/v1/catalogos/practicas',
        '/api/v1/mediciones/definiciones',
      ]) {
        await esperarForbidden(paciente, ruta);
      }
    } finally {
      await paciente.cerrar();
    }

    await deAUnLogin(() => ingresarAlCentro(page, emailPaciente, centro));
    for (const ruta of [
      '/contratacion/convenios',
      '/contratacion/financiadores',
      '/contratacion/arancel-efectivo',
      '/catalogo/especialidades',
      '/catalogo/solicitudes',
    ]) {
      await esperarSinPermiso(page, ruta, centro.nombreCentro);
    }
    await expect(
      page.getByRole('link', { name: 'Convenios de la sede', includeHidden: true, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Catálogo clínico', includeHidden: true, exact: true }),
    ).toHaveCount(0);
  });

  test('PROFESIONAL: lee convenios y catalogo, y no administra el catalogo', async ({ page }) => {
    const { profesional, centro } = propio;
    const convenios = await profesional.pedir(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/convenios`,
    );
    expect(convenios.status(), await convenios.text()).toBe(200);

    await deAUnLogin(() => ingresarAlCentro(page, centro.emailProfesional, centro));
    await expect(
      page.getByRole('link', { name: 'Convenios de la sede', includeHidden: true, exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole('link', { name: 'Catálogo clínico', includeHidden: true, exact: true }),
    ).toHaveCount(1);

    await irA(page, '/contratacion/convenios');
    await expect(
      page.getByRole('heading', { name: 'Convenios de la sede', level: 1 }),
    ).toBeVisible();
    await irA(page, '/catalogo/especialidades');
    await expect(page.getByRole('heading', { name: 'Catálogo clínico', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /^Especialidades que este centro puede usar/, level: 2 }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^Dar de alta una/ })).toHaveCount(0);
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
