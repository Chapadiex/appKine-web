import { nonce, sql } from './support/akine';
import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { ApiAkine, comoProfesional, crearPersona } from './support/sembrado';
import { exigirCon } from './support/sembrado-pantallas-098';

/**
 * E2E de la auditoria por pantalla con la justificacion clinica tapada (ORG-14) contra el backend
 * REAL.
 *
 * <p>La profesional abre la historia clinica de una persona declarando una justificacion con un
 * texto unico. La administradora del centro (ORG_ADMIN, sin `auditoria:read-clinica`) busca el
 * historial de esa historia en Auditoria: ve el hecho —quien, cuando, sobre que entidad— y en el
 * motivo el marcador de redaccion, nunca el texto. El texto SI esta guardado: se lee de la tabla en
 * modo lectura (contenedor de `AKINE_E2E_MYSQL_CONTAINER`, como hace `cuenta-ciclo-real`), que es lo
 * que prueba que la pantalla no lo muestra porque el servidor lo tapa y no porque no exista.
 */
const REDACTADO = '[redactado: exige auditoria:read-clinica]';

test.describe('Auditoria con redaccion clinica contra el backend real', () => {
  let profesional: ApiAkine;

  test.beforeAll(async ({ centro }) => {
    profesional = await comoProfesional(centro);
  });

  test.afterAll(async () => {
    await profesional.cerrar();
  });

  test('la administradora ve el hecho clinico con la justificacion tapada', async ({
    page,
    api,
    centro,
  }) => {
    const justificacion = `Evaluacion inicial sintetica por lumbalgia ${nonce()}`;
    const persona = await crearPersona(api);
    const historia = await exigirCon<{ id: number }>(
      profesional,
      'PUT',
      `/api/v1/historias-clinicas/por-persona/${persona.id}`,
      undefined,
      { 'X-Justificacion-Acceso': justificacion },
    );
    const guardado = sql(
      `SELECT reason FROM audit_event WHERE entity_type = 'HistoriaClinica' ` +
        `AND entity_id = ${historia.id} AND event_type = 'HISTORIA_CLINICA_OPENED'`,
    );
    expect(guardado, 'la justificacion quedo registrada').toBe(justificacion);

    await ingresar(page, centro);
    await navegar(page, '/organizacion/auditoria');
    await page.getByLabel('Historial de una entidad').check();
    await page.getByLabel('Tipo de entidad').fill('HistoriaClinica');
    await page.getByLabel('Numero de la entidad').fill(String(historia.id));
    const consulta = respuestaDe(page, 'GET', /\/audit-events$/);
    await page.getByRole('button', { name: 'Buscar' }).click();
    const respuesta = await consulta;
    expect(respuesta.status()).toBe(200);
    expect(await respuesta.text(), 'el servidor no manda el texto').not.toContain(justificacion);

    const tabla = page.getByRole('region', { name: 'Hechos auditados de la organizacion' });
    const apertura = tabla.getByRole('row').filter({ hasText: 'HISTORIA_CLINICA_OPENED' });
    await expect(apertura).toContainText(`HistoriaClinica ${historia.id}`);
    await expect(apertura).toContainText(REDACTADO);
    await expect(page.getByText(justificacion)).toHaveCount(0);
  });
});
