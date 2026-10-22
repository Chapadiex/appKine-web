import { Page, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { ingresarPorPantalla } from './support/akine';
import { navegar } from './support/agenda-real';
import {
  CentroPropio,
  cerrarCentroPropio,
  expect,
  sembrarCentroPropio,
} from './support/centro-propio';
import { ApiAkine, Persona, crearPersona, deAUnLogin, uriDeProblema } from './support/sembrado';

/**
 * E2E de los permisos sobre la plata (M02 + §32), con una PROFESIONAL contra el backend real.
 *
 * <p>La matriz le niega a `PROFESIONAL` "Registrar Cobro" (No por defecto, otorgable) y "Operar
 * Caja" (No). Ningun spec lo recorria con una cuenta de ese rol: los `flujo-*` operan todo como la
 * administradora. Lo que se afirma, en el orden en que importa:
 *
 * <ol>
 *   <li>el backend la rechaza con `forbidden` por la API, sin depender de la pantalla — caja,
 *       presentaciones, egresos y registrar un cobro;</li>
 *   <li>la pantalla no le abre esas secciones por URL: `/sin-permiso`, no una pantalla rota;</li>
 *   <li>un permiso adicional otorgado y despues quitado vale <b>contra la base</b> y no contra el
 *       token: con el MISMO access token, presentaciones pasa a responder y vuelve a negarse
 *       (§3 de la matriz: "toda operacion sensible re-verifica la membership contra la base").</li>
 * </ol>
 *
 * <p>Centro propio (`support/centro-propio.ts`): se otorgan y quitan permisos de una membership del
 * centro.
 */
test.describe.configure({ mode: 'default' });

/** Otorgable a PROFESIONAL (§2 "Gestionar paciente: Segun permiso"). */
const PERMISO = 'paciente:manage';

test.describe('Permisos sobre la plata con una profesional contra el backend real', () => {
  let propio: CentroPropio;
  let persona: Persona;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    propio = await sembrarCentroPropio('permisos');
    persona = await crearPersona(propio.api);
  });

  test.afterAll(async () => {
    await cerrarCentroPropio(propio);
  });

  test('el backend le niega caja, presentaciones, egresos y cobros, y la pantalla no los abre', async ({
    page,
  }) => {
    const { profesional, centro } = propio;
    const sede = `/api/v1/consultorios/${centro.consultorioId}`;

    for (const ruta of [
      `${sede}/caja/jornadas?estado=ABIERTA&limite=1`,
      `${sede}/presentaciones`,
      `${sede}/egresos`,
    ]) {
      await esperarForbidden(profesional, 'GET', ruta);
    }
    await esperarForbidden(profesional, 'POST', `${sede}/cobros`, {
      personaId: persona.id,
      total: 100,
      anticipo: 100,
      moneda: 'ARS',
      medios: [{ medio: 'TRANSFERENCIA', importe: 100, referencia: 'TRF-PERMISOS' }],
      imputaciones: [],
      idempotencyKey: randomUUID(),
    });
    await esperarForbidden(profesional, 'POST', `${sede}/caja/jornadas`, {
      moneda: 'ARS',
      saldoInicial: 0,
    });

    await entrarComoProfesional(page, propio);
    for (const ruta of [
      '/caja',
      '/presentaciones',
      '/egresos',
      `/pacientes/${persona.id}/cuenta-corriente/cobrar`,
    ]) {
      await navegar(page, '/');
      await page.evaluate((destino) => {
        history.pushState(null, '', destino);
        dispatchEvent(new PopStateEvent('popstate', { state: null }));
      }, ruta);
      await expect(page, `${ruta} no se le abre`).toHaveURL(/\/sin-permiso$/);
      await expect(
        page.getByRole('heading', { name: 'No tenés permiso para esta pantalla', level: 1 }),
      ).toBeVisible();
      await expect(page.getByText(centro.nombreCentro, { exact: true })).toBeVisible();
    }

    // La cuenta corriente no tiene guard (la lectura la decide el backend): abre, dice por que no
    // muestra nada y no ofrece cobrar.
    await navegar(page, `/pacientes/${persona.id}/cuenta-corriente`);
    await expect(page.getByRole('heading', { name: 'Cuenta corriente', level: 1 })).toBeVisible();
    await expect(page.getByText(/No tenes permiso para ver ni anular deudas/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Registrar un cobro' })).toHaveCount(0);
  });

  test('un permiso otorgado y quitado vale contra la base, no contra el token', async () => {
    const { api, profesional, centro } = propio;
    const org = `/api/v1/organizations/${centro.organizationId}`;
    const grants = `${org}/memberships/${centro.profesional.membershipId}/grants`;
    const altaDePersona = () => ({
      nombre: 'Grant',
      apellido: `Sintetico${randomUUID().slice(0, 6)}`,
    });

    // "Operar Caja" es "No" para PROFESIONAL: ni por grant. El servidor lo rechaza con su tipo.
    const caja = await api.pedir('POST', grants, {
      permissionCode: 'caja:operate',
      reason: 'Intento de abrirle la caja a una profesional',
    });
    expect(caja.status(), await caja.text()).toBe(400);
    expect(((await caja.json()) as { type: string }).type).toBe(
      uriDeProblema('permiso-no-otorgable-al-rol'),
    );
    await esperarForbidden(
      profesional,
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/caja/jornadas`,
    );

    // "Gestionar paciente" es "Segun permiso": otorgable. Sin el, el alta en el padron se niega.
    await esperarForbidden(profesional, 'POST', '/api/v1/personas', altaDePersona());
    await api.exigir('POST', grants, {
      permissionCode: PERMISO,
      reason: 'Carga el padron durante la licencia de la administrativa',
    });

    // El MISMO token de la profesional, sin volver a ingresar: el permiso se evalua contra la base.
    const conPermiso = await profesional.pedir('POST', '/api/v1/personas', altaDePersona());
    expect(conPermiso.status(), await conPermiso.text()).toBe(201);

    const baja = await api.pedir('DELETE', `${grants}/${PERMISO}?reason=Termino%20la%20licencia`);
    expect(baja.status(), await baja.text()).toBe(204);

    // Y quitado, el mismo token deja de servir en el acto: no espera a que el token venza.
    await esperarForbidden(profesional, 'POST', '/api/v1/personas', altaDePersona());
  });
});

async function esperarForbidden(
  api: ApiAkine,
  metodo: 'GET' | 'POST',
  ruta: string,
  cuerpo?: unknown,
): Promise<void> {
  const respuesta = await api.pedir(metodo, ruta, cuerpo);
  expect(respuesta.status(), `${metodo} ${ruta}: ${await respuesta.text()}`).toBe(403);
  expect(((await respuesta.json()) as { type: string }).type).toBe(uriDeProblema('forbidden'));
}

/** La profesional tiene dos contextos (su consultorio propio y el centro): elige el del centro. */
async function entrarComoProfesional(page: Page, propio: CentroPropio): Promise<void> {
  await deAUnLogin(async () => {
    await ingresarPorPantalla(page, propio.centro.emailProfesional);
    await expect(page).toHaveURL(/\/seleccionar-contexto/, { timeout: 30_000 });
  });
  await page
    .getByRole('button', {
      name: new RegExp(propio.centro.nombreCentro.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    })
    .click();
  await expect(page).not.toHaveURL(/\/(auth|seleccionar-contexto)/, { timeout: 30_000 });
}
