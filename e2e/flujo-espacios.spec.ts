import { expect, ingresar, navegar, problemaDe, respuestaDe, test } from './support/agenda-real';
import { abrirFiltros } from './support/filtros';
import { nonce } from './support/akine';
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
    await page.getByLabel('Nombre del espacio').fill(nombre);
    await page.getByLabel('Personas simultaneas que admite').fill('1');
    const alta = respuestaDe(page, 'POST', /\/espacios$/);
    await page.getByRole('button', { name: 'Dar de alta el espacio' }).click();
    const creado = await alta;
    expect(creado.status(), await creado.text()).toBe(201);
    const { id: espacioId } = (await creado.json()) as { id: number };
    await expect(page.getByText(`${nombre} quedo dado de alta`)).toBeVisible();

    await page.getByRole('link', { name: 'Ver los espacios de la sede' }).click();
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
      'No se puede dar de baja este espacio porque todavia tiene 1 turno pendiente',
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

    await abrirFiltros(page);
    await page.getByLabel('Mostrar').selectOption({ label: 'Solo los dados de baja' });
    const historico = page.getByRole('row').filter({ hasText: nombre });
    await expect(historico).toBeVisible();
    await expect(historico.getByText('Motivo: Se reforma el box')).toBeVisible();
    await expect(historico.getByText('Un espacio dado de baja no se edita.')).toBeVisible();
  });
});
