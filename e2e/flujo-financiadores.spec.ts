import { nonce } from './support/akine';
import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { fechaLocal, sumarDias } from './support/sembrado';

/**
 * E2E de financiadores y planes (M16, AKINE-03.02) contra el backend REAL, todo por pantalla: alta
 * de una obra social, busqueda en el listado, alta de un plan con copago y autorizacion previa, y el
 * convenio de la sede con ese plan (M17).
 *
 * <p>Los demas specs siembran financiador y plan por la API (`crearFinanciador`); este es el que
 * recorre las dos pantallas. Lo que se afirma se relee del servidor: el copago viaja con su moneda
 * y las dos marcas del plan quedan guardadas.
 */

interface PlanGuardado {
  readonly id: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly copago?: number;
  readonly moneda?: string;
  readonly requiereAutorizacion?: boolean;
  readonly requiereCredencial?: boolean;
  readonly vigenciaDesde?: string;
}

test.describe('Financiadores y planes contra el backend real', () => {
  test('alta de una obra social, su plan con copago y el convenio de la sede, por pantalla', async ({
    page,
    api,
    centro,
  }) => {
    const sufijo = nonce();
    const nombre = `Obra Social Pantalla ${sufijo}`;
    const codigo = `OSP${sufijo}`.slice(0, 20);

    await ingresar(page, centro);
    await navegar(page, '/contratacion/financiadores');
    await expect(page.getByRole('heading', { name: 'Financiadores', level: 1 })).toBeVisible();

    // --- Alta del financiador ---------------------------------------------------------------
    await page.getByRole('button', { name: 'Dar de alta un financiador' }).click();
    const formulario = page.getByRole('region', { name: 'Nuevo financiador' });
    await formulario.getByLabel('Codigo', { exact: true }).fill(codigo);
    await formulario.getByLabel('Nombre', { exact: true }).fill(nombre);
    await formulario.getByLabel('Tipo', { exact: true }).selectOption({ value: 'OBRA_SOCIAL' });
    const alta = respuestaDe(page, 'POST', /\/financiadores$/);
    await formulario.getByRole('button', { name: 'Dar de alta', exact: true }).click();
    const creada = await alta;
    expect(creada.status(), await creada.text()).toBe(201);
    const { id: financiadorId } = (await creada.json()) as { id: number };

    // El listado acumula los financiadores de todas las corridas: se busca por nombre.
    await page.getByLabel('Buscar', { exact: true }).fill(nombre);
    // Sin boton a la vista (regla de filtros, UX-01): Enter envia el formulario de busqueda.
    await page.getByLabel('Buscar', { exact: true }).press('Enter');
    const fila = page.getByRole('region', { name: 'Financiadores' }).getByRole('row', {
      name: new RegExp(nombre),
    });
    await expect(fila).toContainText(`Codigo ${codigo}`);
    await expect(fila).toContainText('Activo');
    await fila.getByRole('link', { name: 'Planes' }).click();

    // --- Alta del plan, con copago y autorizacion previa ------------------------------------
    await expect(
      page.getByRole('heading', { name: `Planes de ${nombre}`, level: 1 }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Dar de alta un plan' }).click();
    const formularioDelPlan = page.getByRole('region', { name: 'Nuevo plan' });
    const plan = `Plan 310 ${sufijo}`;
    const desde = sumarDias(fechaLocal(centro.timezone), -1);
    await formularioDelPlan
      .getByLabel('Codigo', { exact: true })
      .fill(`P310${sufijo}`.slice(0, 20));
    await formularioDelPlan.getByLabel('Nombre', { exact: true }).fill(plan);
    await formularioDelPlan.getByLabel('Vigente desde').fill(desde);
    await formularioDelPlan.getByLabel('Copago (opcional)').fill('1500');
    await formularioDelPlan.getByLabel('Moneda').fill('ARS');
    await formularioDelPlan.getByLabel('Requiere autorizacion previa').check();
    const altaDelPlan = respuestaDe(page, 'POST', /\/financiadores\/\d+\/planes$/);
    await formularioDelPlan.getByRole('button', { name: 'Dar de alta', exact: true }).click();
    const planCreado = await altaDelPlan;
    expect(planCreado.status(), await planCreado.text()).toBe(201);
    await expect(
      page.getByRole('region', { name: 'Planes de cobertura' }).getByRole('row', {
        name: new RegExp(plan),
      }),
    ).toBeVisible();

    // --- Lo que guardo el servidor ----------------------------------------------------------
    const planes = await api.exigir<PlanGuardado[] | { content: PlanGuardado[] }>(
      'GET',
      `/api/v1/financiadores/${financiadorId}/planes`,
    );
    const guardado = (Array.isArray(planes) ? planes : planes.content).find(
      (p) => p.nombre === plan,
    );
    expect(guardado).toMatchObject({
      copago: 1500,
      moneda: 'ARS',
      requiereAutorizacion: true,
      requiereCredencial: false,
      vigenciaDesde: desde,
    });

    // --- La sede firma un convenio con ese plan -----------------------------------------------
    await navegar(page, '/contratacion/convenios');
    await page.getByRole('button', { name: 'Firmar un convenio' }).click();
    const formularioDelConvenio = page.getByRole('region', {
      name: 'Nuevo convenio de esta sede',
    });
    const convenio = `Convenio 310 ${sufijo}`;
    await formularioDelConvenio
      .getByLabel('Financiador')
      .selectOption({ value: String(financiadorId) });
    await formularioDelConvenio.getByLabel('Plan').selectOption({ value: String(guardado!.id) });
    await formularioDelConvenio
      .getByLabel('Codigo', { exact: true })
      .fill(`CV310${sufijo}`.slice(0, 20));
    await formularioDelConvenio.getByLabel('Nombre', { exact: true }).fill(convenio);
    await formularioDelConvenio
      .getByLabel('Modalidad de liquidacion')
      .selectOption({ value: 'POR_PRESTACION' });
    await formularioDelConvenio.getByLabel('Moneda').fill('ARS');
    await formularioDelConvenio.getByLabel('Vigente desde').fill(desde);
    const firma = respuestaDe(page, 'POST', /\/consultorios\/\d+\/convenios$/);
    await formularioDelConvenio.getByRole('button', { name: 'Firmar convenio' }).click();
    const firmado = await firma;
    expect(firmado.status(), await firmado.text()).toBe(201);
    expect(await firmado.json()).toMatchObject({
      financiadorId,
      planId: guardado!.id,
      modalidad: 'POR_PRESTACION',
      moneda: 'ARS',
    });
    await expect(
      page.getByRole('region', { name: 'Convenios de la sede' }).getByRole('row', {
        name: new RegExp(convenio),
      }),
    ).toBeVisible();
  });
});
