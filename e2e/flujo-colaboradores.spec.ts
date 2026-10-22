import { Locator, Page } from '@playwright/test';

import { emailUnico, nonce, registrarPorApi } from './support/akine';
import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { ApiAkine, Centro, uriDeProblema } from './support/sembrado';

/**
 * E2E de los permisos adicionales de un colaborador (G-5, web #44/#48) contra el backend REAL.
 *
 * <p>El selector ofrece SOLO lo que `permisos-otorgables` admite para el rol de la persona; se otorga
 * uno, se le cambia el rol por otro que no lo admite, y el grant queda listado con la marca "No
 * vigente con el rol actual": sigue registrado pero ya no concede acceso.
 *
 * <p>La persona es una cuenta nueva, vinculada como ADMINISTRADORA DE SEDE por `POST /memberships`
 * (vincula a alguien ya registrado, no hace falta activarla). No se usa la profesional del centro
 * compartido: cambiarle el rol romperia a los specs que cierran sesiones con ella.
 */

const PERMISO = 'auditoria:read-clinica';

async function otorgables(api: ApiAkine, centro: Centro, rol: string): Promise<string[]> {
  const respuesta = await api.exigir<{ permissionCodes?: string[] }>(
    'GET',
    `/api/v1/organizations/${centro.organizationId}/roles/${rol}/permisos-otorgables`,
  );
  return [...(respuesta.permissionCodes ?? [])].sort();
}

/** Las opciones reales del selector, sin el placeholder. */
async function opcionesDelSelector(selector: Locator): Promise<string[]> {
  const valores = await selector
    .locator('option')
    .evaluateAll((opciones) =>
      opciones.map((o) => (o as HTMLOptionElement).value).filter((v) => v !== ''),
    );
  return valores.sort();
}

function filaDe(page: Page, email: string): Locator {
  return page
    .getByRole('region', { name: 'Colaboradores de la organización' })
    .getByRole('row')
    .filter({ hasText: email });
}

test.describe('Permisos adicionales de un colaborador contra el backend real', () => {
  test('el selector ofrece lo otorgable al rol, y el grant queda "No vigente" al cambiar de rol', async ({
    page,
    request,
    api,
    centro,
  }) => {
    test.slow();
    const email = emailUnico('e2e.colaborador');
    await registrarPorApi(request, {
      email,
      organizationName: `Consultorio de la colaboradora ${nonce()}`,
      firstName: 'Carla',
      lastName: 'Colaboradora',
    });
    const { membershipId } = await api.exigir<{ membershipId: number }>(
      'POST',
      '/api/v1/memberships',
      {
        email,
        roleCode: 'CONSULTORIO_ADMIN',
        consultorioId: centro.consultorioId,
        reason: 'Colaboradora sintetica de los E2E de permisos',
      },
    );

    const delAdminDeSede = await otorgables(api, centro, 'CONSULTORIO_ADMIN');
    const delProfesional = await otorgables(api, centro, 'PROFESIONAL');
    // Las precondiciones del escenario, tal como las declara la matriz: si cambian, el test pierde
    // sentido y tiene que decirlo aca y no como un fallo de pantalla.
    expect(delAdminDeSede, 'la matriz admite el permiso para el admin de sede').toContain(PERMISO);
    expect(delProfesional, 'la matriz NO admite el permiso para el profesional').not.toContain(
      PERMISO,
    );

    await ingresar(page, centro);
    await navegar(page, '/organizacion/colaboradores');
    await expect(filaDe(page, email)).toContainText('Administrador de sede');

    // --- El selector ofrece exactamente lo que el backend admite para el rol ----------------
    await filaDe(page, email).getByRole('button', { name: 'Permisos adicionales' }).click();
    await expect(page.getByText('Este colaborador no tiene permisos adicionales.')).toBeVisible();
    const selector = page.getByLabel('Permiso a otorgar');
    await expect(
      page.getByText(/Solo se ofrecen los que la matriz admite para el rol/),
    ).toBeVisible();
    expect(await opcionesDelSelector(selector)).toEqual(delAdminDeSede);

    await selector.selectOption(PERMISO);
    await page.locator('#grant-reason').fill('Revisa la auditoria clinica de la sede');
    const alta = respuestaDe(page, 'POST', /\/memberships\/\d+\/grants$/);
    await page.getByRole('button', { name: 'Otorgar' }).click();
    expect((await alta).status()).toBe(201);
    await expect(page.getByText('Permiso adicional otorgado.')).toBeVisible();
    const grant = page.locator('.lista-grants li').filter({ hasText: PERMISO });
    await expect(grant).toBeVisible();
    await expect(grant.getByText('No vigente con el rol actual')).toHaveCount(0);
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();

    // --- Cambio de rol a uno que no lo admite -----------------------------------------------
    await filaDe(page, email).getByRole('button', { name: 'Cambiar rol o alcance' }).click();
    await page.locator('#edicion-roleCode').selectOption({ label: 'Profesional' });
    await page.locator('#edicion-reason').fill('Pasa a atender pacientes');
    await page.getByRole('button', { name: 'Aplicar el cambio' }).click();
    await expect(filaDe(page, email)).toContainText('Profesional');

    await filaDe(page, email).getByRole('button', { name: 'Permisos adicionales' }).click();
    const noVigente = page.locator('.lista-grants li').filter({ hasText: PERMISO });
    await expect(noVigente.getByText('No vigente con el rol actual')).toBeVisible();
    await expect(noVigente.getByText(/sigue registrado pero no concede acceso/)).toBeVisible();
    // El selector ya ofrece lo del rol nuevo, que no incluye el permiso.
    await expect(selector.locator(`option[value="${PERMISO}"]`)).toHaveCount(0);
    expect(await opcionesDelSelector(selector)).toEqual(delProfesional);

    // El backend rechaza volver a otorgarlo con su tipo: el selector no lo ofrece, pero la regla
    // la decide el servidor.
    const rechazo = await api.pedir(
      'POST',
      `/api/v1/organizations/${centro.organizationId}/memberships/${membershipId}/grants`,
      { permissionCode: PERMISO, reason: 'Intento por fuera de la pantalla' },
    );
    expect(rechazo.status(), await rechazo.text()).toBe(400);
    expect(((await rechazo.json()) as { type: string }).type).toBe(
      uriDeProblema('permiso-no-otorgable-al-rol'),
    );

    // Dar de baja el grant que quedo sin efecto, desde la misma lista: el motivo es el mismo campo.
    await page.locator('#grant-reason').fill('Ya no corresponde con el rol de profesional');
    const baja = respuestaDe(page, 'DELETE', /\/grants\/[^/]+$/);
    await noVigente.getByRole('button', { name: 'Dar de baja' }).click();
    expect((await baja).status()).toBe(204);
    await expect(page.getByText('Permiso adicional dado de baja.')).toBeVisible();
    await expect(page.getByText('Este colaborador no tiene permisos adicionales.')).toBeVisible();
  });
});
