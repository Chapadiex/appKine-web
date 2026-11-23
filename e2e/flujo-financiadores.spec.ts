import { nonce } from './support/akine';
import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { fechaLocal, sumarDias } from './support/sembrado';

/**
 * E2E de financiadores y planes (M16, AKINE-03.02) contra el backend REAL, todo por pantalla: alta
 * de una obra social, busqueda en el listado, alta de un plan con copago y autorizacion previa, y la
 * apertura de los precios del plan, que valen para todas las sedes (contrato 0.187.0).
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
  test('alta de una obra social, su plan con copago y sus precios, por pantalla', async ({
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
    const formulario = page.getByRole('dialog', { name: 'Nuevo financiador' });
    await formulario.getByLabel('Código', { exact: true }).fill(codigo);
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
    await expect(fila).toContainText(`Código ${codigo}`);
    await expect(fila).toContainText('Activo');
    // Patron de listado (UX-14): el conteo en la toolbar y el pie estandar debajo de la tabla.
    await expect(page.locator('.filtros-barra__resultados')).toHaveText('1 financiador');
    await expect(page.locator('.paginacion-pie__resumen')).toHaveText('Mostrando 1–1 de 1');
    await fila.getByRole('link', { name: 'Planes' }).click();

    // --- Alta del plan, con copago y autorizacion previa ------------------------------------
    await expect(
      page.getByRole('heading', { name: `Planes de ${nombre}`, level: 1 }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Dar de alta un plan' }).click();
    const formularioDelPlan = page.getByRole('dialog', { name: 'Nuevo plan' });
    const plan = `Plan 310 ${sufijo}`;
    const desde = sumarDias(fechaLocal(centro.timezone), -1);
    await formularioDelPlan
      .getByLabel('Código', { exact: true })
      .fill(`P310${sufijo}`.slice(0, 20));
    await formularioDelPlan.getByLabel('Nombre', { exact: true }).fill(plan);
    await formularioDelPlan.getByLabel('Vigente desde').fill(desde);
    await formularioDelPlan.getByLabel('Copago (opcional)').fill('1500');
    await formularioDelPlan.getByLabel('Moneda').fill('ARS');
    // UX-11: descripcion y requisitos viven en la seccion plegada "Más datos del plan".
    await formularioDelPlan.locator('summary', { hasText: 'Más datos del plan' }).click();
    await formularioDelPlan.getByLabel('Requiere autorización previa').check();
    const altaDelPlan = respuestaDe(page, 'POST', /\/financiadores\/\d+\/planes$/);
    await formularioDelPlan.getByRole('button', { name: 'Dar de alta', exact: true }).click();
    const planCreado = await altaDelPlan;
    expect(planCreado.status(), await planCreado.text()).toBe(201);
    await expect(
      page.getByRole('region', { name: 'Planes de cobertura' }).getByRole('row', {
        name: new RegExp(plan),
      }),
    ).toBeVisible();
    await expect(page.locator('.filtros-barra__resultados')).toHaveText('1 plan');

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

    // --- Los precios del plan: se abren desde su fila y valen para todas las sedes -------------
    await navegar(page, `/contratacion/financiadores/${financiadorId}/planes`);
    const filaDelPlan = page
      .getByRole('region', { name: 'Planes de cobertura' })
      .getByRole('row', { name: new RegExp(plan) });
    const preparacion = respuestaDe(page, 'POST', /\/planes\/\d+\/convenio$/);
    await filaDelPlan.getByRole('button', { name: 'Precios', exact: true }).click();
    const preparado = await preparacion;
    expect(preparado.status(), await preparado.text()).toBe(200);
    expect(await preparado.json()).toMatchObject({
      financiadorId,
      planId: guardado!.id,
      consultorioId: null,
      moneda: 'ARS',
      requiereAutorizacion: true,
    });
    await expect(page).toHaveURL(/\/contratacion\/convenios\/\d+\/aranceles$/);
    await expect(
      page.getByRole('heading', { name: new RegExp(`^Precios de .*${plan}`), level: 1 }),
    ).toBeVisible();
  });
});
