import { expect, navegar, respuestaDe, test } from './support/agenda-real';
import { comoProfesional, crearOferta, crearPersona } from './support/sembrado';
import { ingresarAlCentro } from './support/sembrado-pantallas-098';

/**
 * E2E de la atencion sin turno (DP-43, U-24) contra el backend REAL, por pantalla y como la
 * PROFESIONAL: `sesion:register` es de ese rol, y quien atiende es quien inicia.
 *
 * <p>Lo que estos pasos prueban y los unitarios no: que el backend acepte la oferta elegida por el
 * cliente, que el motivo vuelva en `motivoSinTurno`, que la atencion abierta sea la misma pantalla
 * que la de un turno, y que la `idempotencyKey` de la pantalla haga que repetir el MISMO pedido
 * devuelva la MISMA atencion.
 *
 * <p>La oferta va sin habilitaciones explicitas (la presta cualquier profesional de la sede): una
 * habilitacion cargada hoy podria no valer para hoy.
 */
test.describe('Atencion sin turno contra el backend real', () => {
  test('oferta, persona y motivo abren la atencion; el mismo pedido no abre otra', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro, { habilitarProfesional: false });
    const persona = await crearPersona(api);

    await ingresarAlCentro(page, centro.emailProfesional, centro);
    await navegar(page, '/atencion/sin-turno');
    await expect(page.getByRole('heading', { name: 'Atender sin turno', level: 1 })).toBeVisible();

    await page.getByLabel('Documento, apellido, nombre o teléfono').fill(persona.apellido);
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await page
      .getByRole('button', { name: new RegExp(`^${persona.apellido}, ${persona.nombre}`) })
      .click();
    await page.getByLabel('Oferta', { exact: true }).selectOption({ label: oferta.nombre });

    // Sin motivo no sale nada.
    await page.getByRole('button', { name: 'Iniciar atención' }).click();
    await expect(
      page.getByText('Escribi por que se atiende sin turno: es obligatorio.'),
    ).toBeVisible();

    await page.getByLabel('Motivo (obligatorio)').fill('Consulta espontanea por dolor lumbar');
    const inicio = respuestaDe(page, 'POST', /\/consultorios\/\d+\/sesiones$/);
    await page.getByRole('button', { name: 'Iniciar atención' }).click();
    const respuesta = await inicio;
    expect(respuesta.status(), await respuesta.text()).toBeLessThan(300);
    const sesion = (await respuesta.json()) as { id: number; turnoId?: number };
    const cuerpo = respuesta.request().postDataJSON() as Record<string, unknown>;
    expect(cuerpo['idempotencyKey']).toBeTruthy();

    await expect(page).toHaveURL(new RegExp(`/atencion/sesiones/${sesion.id}$`));
    await expect(page.getByRole('heading', { name: 'Atención en curso' })).toBeVisible();

    const profesional = await comoProfesional(centro);
    const guardada = await profesional.exigir<{
      id: number;
      turnoId?: number;
      motivoSinTurno?: string;
      ofertaId?: number;
    }>('GET', `/api/v1/consultorios/${centro.consultorioId}/sesiones/${sesion.id}`);
    expect(guardada.turnoId).toBeUndefined();
    expect(guardada.ofertaId).toBe(oferta.id);
    expect(guardada.motivoSinTurno).toBe('Consulta espontanea por dolor lumbar');

    // El doble click: el MISMO pedido con la MISMA clave devuelve la misma atencion.
    const repetida = await profesional.exigir<{ id: number }>(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/sesiones`,
      cuerpo,
    );
    expect(repetida.id).toBe(sesion.id);
  });
});
