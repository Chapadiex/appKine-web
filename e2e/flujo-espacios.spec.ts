import { expect, ingresar, navegar, problemaDe, respuestaDe, test } from './support/agenda-real';
import { abrirAcciones, abrirFiltros } from './support/filtros';
import { esperarFormularioEnlazado, nonce } from './support/akine';
import {
  crearOferta,
  crearPersona,
  diaDeTrabajo,
  reservar,
  uriDeProblema,
} from './support/sembrado';
import { DIAS_CONFIGURACION } from './support/sembrado-configuracion';

/**
 * E2E de espacios y boxes (M04, AKINE-02.02) contra el backend REAL: alta del box por pantalla,
 * baja rechazada porque tiene un turno pendiente, y baja con motivo una vez resuelto.
 *
 * <p>El `409 espacio-has-active-references` estuvo RESERVADO desde 02.02 y lo empezo a emitir E-1
 * (`EspacioOcupadoPorTurnos`): ningun test del frontend lo habia visto salir del servidor. El turno
 * cae en el box porque la oferta exige espacio y solo tiene habilitado ese.
 */
test.describe('Espacios y boxes contra el backend real', () => {
  test.beforeEach(async ({ page, centro }) => {
    await ingresar(page, centro);
  });

  test('alta del box, baja frenada por un turno pendiente y baja con motivo', async ({
    page,
    api,
    centro,
  }) => {
    const nombre = `Box E2E ${nonce()}`;

    // --- Alta por pantalla ---
    await navegar(page, '/espacios');
    await page.getByRole('link', { name: 'Dar de alta un espacio' }).click();
    // El alta la monta el router: ver `esperarFormularioEnlazado`.
    await esperarFormularioEnlazado(page.getByLabel('Nombre del espacio'));
    await page.getByLabel('Nombre del espacio').fill(nombre);
    await page.getByLabel('Personas simultaneas que admite').fill('1');
    const alta = respuestaDe(page, 'POST', /\/espacios$/);
    await page.getByRole('button', { name: 'Dar de alta el espacio' }).click();
    const creado = await alta;
    expect(creado.status(), await creado.text()).toBe(201);
    const { id: espacioId } = (await creado.json()) as { id: number };
    // UX-12: el alta vuelve sola al listado y el resultado va al aviso global.
    const notificaciones = page.getByRole('region', { name: 'Notificaciones', exact: true });
    await expect(notificaciones.getByText('Espacio dado de alta')).toBeVisible();
    await expect(notificaciones.getByText(nombre, { exact: false })).toBeVisible();
    await expect(page).toHaveURL(/\/espacios$/);
    // UX-14: el listado pagina de a 10 y el centro sembrado puede tener mas boxes; se busca por
    // nombre, y la cuenta queda en la barra de la tabla.
    const listado = respuestaDe(page, 'GET', /\/espacios$/);
    await page.getByLabel('Nombre del espacio').fill(nombre);
    await page.getByLabel('Nombre del espacio').press('Enter');
    expect((await listado).status()).toBe(200);
    await expect(page.locator('.filtros-barra__resultados')).toHaveText('1 espacio');
    await expect(page.getByText('Mostrando 1–1 de 1')).toBeVisible();
    const fila = page.getByRole('row').filter({ hasText: nombre });
    await expect(fila).toBeVisible();
    await expect(fila.getByText('En servicio', { exact: false })).toBeVisible();

    // --- Un turno pendiente en ese box ---
    const base = await crearOferta(api, centro, {
      nombre: `Box ${nonce()}`,
      extra: { requiereEspacio: true },
    });
    await api.exigir(
      'PUT',
      `/api/v1/consultorios/${centro.consultorioId}/ofertas/${base.id}/habilitaciones/espacios`,
      { expectedVersion: base.version, ids: [espacioId] },
    );
    const persona = await crearPersona(api);
    const { slots } = await diaDeTrabajo(api, centro, base.id, DIAS_CONFIGURACION.espacioConTurno);
    const turno = await reservar(api, centro, base.id, persona.id, slots[0].desde);
    expect((turno as unknown as { espacioId?: number }).espacioId).toBe(espacioId);

    // --- La baja la frena el servidor, y la pantalla dice por que ---
    await abrirAcciones(fila);
    await fila.getByRole('button', { name: 'Dar de baja' }).click();
    await page.getByLabel('Motivo de la baja').fill('Se reforma el box');
    const rechazo = respuestaDe(page, 'POST', /\/espacios\/\d+\/deactivate$/);
    await page.getByRole('button', { name: 'Confirmar la baja' }).click();
    const respuesta = await rechazo;
    expect(respuesta.status()).toBe(409);
    const problema = await problemaDe(respuesta);
    expect(problema.type).toBe(uriDeProblema('espacio-has-active-references'));
    expect(problema['referenceCount']).toBe(1);
    await expect(page.getByRole('alert')).toContainText(
      'No se puede dar de baja este espacio porque todavía tiene 1 turno pendiente',
    );

    // --- Resuelto el turno, la baja pasa y el box queda en el historico con su motivo ---
    await api.exigir(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/turnos/${turno.id}/cancelacion`,
      { motivo: 'Se reubica por la reforma del box', expectedVersion: turno.version },
    );
    const baja = respuestaDe(page, 'POST', /\/espacios\/\d+\/deactivate$/);
    await page.getByRole('button', { name: 'Confirmar la baja' }).click();
    expect((await baja).status()).toBe(200);
    await expect(fila).toHaveCount(0);
    // Con la busqueda puesta y sin resultados activos: el vacio filtrado ofrece limpiar.
    await expect(
      page.getByRole('status').filter({ hasText: 'Ningún espacio coincide' }),
    ).toBeVisible();

    await abrirFiltros(page);
    await page.getByLabel('Mostrar').selectOption({ label: 'Solo los dados de baja' });
    const historico = page.getByRole('row').filter({ hasText: nombre });
    await expect(historico).toBeVisible();
    await expect(historico.getByText('Motivo: Se reforma el box')).toBeVisible();
    // UX-11: la fila de un espacio dado de baja no ofrece acciones (antes lo decia con un texto).
    await expect(historico.getByRole('button', { name: 'Editar' })).toHaveCount(0);
    await expect(historico.getByRole('button', { name: /^Más acciones de / })).toHaveCount(0);
  });
});
