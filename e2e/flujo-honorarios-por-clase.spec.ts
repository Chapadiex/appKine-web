import { Page } from '@playwright/test';

import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { ClaseSembrada, claseConInscriptos } from './support/sembrado-asistencia';
import { ApiAkine, Centro, crearOferta, fechaLocal } from './support/sembrado';

/**
 * E2E de los honorarios por clase (DP-38, appKine-api #164) y del servicio en el egreso (DP-39,
 * #162) contra el backend REAL.
 *
 * <p>Circuito completo: tarifa por participante en la oferta → clase con DOS instructores
 * adicionales (la profesional y la administradora: el adicional no exige rol PROFESIONAL) →
 * asistencia con dos presentes y un ausente → borrador de la profesional → confirmar → el egreso
 * nace en BORRADOR, imputado a la oferta, con enlace a la liquidacion.
 *
 * <p>La cuenta: 2 presentes x 1.500 = 3.000 por la clase, repartidos entre 2 instructores = 1.500
 * para cada uno. El borrador se pide acotado a la oferta del test, que es nueva en cada corrida:
 * una clase de una corrida anterior sobre la misma base no cambia el numero.
 */

const DIAS_HONORARIOS = 163;
const TARIFA = '1500';

interface Vinculo {
  readonly id: number;
  readonly accountName?: string;
  readonly accountEmail?: string;
  readonly estado?: string;
}

/** Como lo nombra la pantalla: el mismo criterio que `nombreDe` de egresos e instructores. */
function nombreDe(vinculo: Vinculo): string {
  return vinculo.accountName || vinculo.accountEmail || `Vinculo ${vinculo.id}`;
}

async function vinculos(api: ApiAkine, centro: Centro): Promise<Vinculo[]> {
  const pagina = await api.exigir<{ content: Vinculo[] }>(
    'GET',
    `/api/v1/organizations/${centro.organizationId}/memberships?size=200`,
  );
  return pagina.content.filter((v) => v.estado === 'ACTIVA');
}

function dato(page: Page, etiqueta: string) {
  return page.locator('dt', { hasText: etiqueta }).locator('xpath=following-sibling::dd[1]');
}

test.describe('Honorarios por clase contra el backend real', () => {
  let clase: ClaseSembrada;
  let ofertaId: number;
  let ofertaNombre: string;
  let profesional: Vinculo;
  let administradora: Vinculo;
  /** Egreso creado por el test: se anula al final, libera la liquidacion. */
  let egresoCreado: number | null = null;

  test.beforeEach(async ({ page, api, centro }) => {
    clase = await claseConInscriptos(api, centro, DIAS_HONORARIOS, 3);
    const detalle = await api.exigir<{ ofertaId: number; ofertaNombre: string }>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/clases/${clase.id}`,
    );
    ofertaId = detalle.ofertaId;
    ofertaNombre = detalle.ofertaNombre;
    const todos = await vinculos(api, centro);
    profesional = todos.find((v) => v.id === centro.profesional.membershipId)!;
    administradora = todos.find((v) => v.accountEmail === centro.emailAdmin)!;
    expect(profesional).toBeTruthy();
    expect(administradora).toBeTruthy();
    await ingresar(page, centro);
  });

  test.afterEach(async ({ api, centro }) => {
    if (egresoCreado !== null) {
      await api.pedir(
        'POST',
        `/api/v1/consultorios/${centro.consultorioId}/egresos/${egresoCreado}/anulacion`,
        { motivo: 'Limpieza del E2E de honorarios' },
      );
      egresoCreado = null;
    }
  });

  test('tarifa → dos instructores → asistencia → borrador → confirmar → egreso con oferta', async ({
    page,
    api,
    centro,
  }) => {
    // ---- 1. La tarifa por participante presente, en la oferta.
    await navegar(page, `/servicios/ofertas/${ofertaId}/honorarios`);
    await expect(
      page.getByRole('heading', { name: 'Honorarios por clase de la oferta', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('sus clases no entran en ninguna liquidación')).toBeVisible();
    await page.getByRole('button', { name: 'Cargar una tarifa' }).click();
    await page.getByLabel('Importe por participante presente').fill(TARIFA);
    const alta = respuestaDe(page, 'POST', /\/honorarios-por-clase$/);
    await page.getByRole('button', { name: 'Cargar tarifa' }).click();
    expect((await alta).status()).toBe(201);
    await expect(page.getByText('La tarifa quedo cargada')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '1500' })).toContainText('Rige hoy');

    // ---- 2. Dos instructores adicionales en la clase (sin principal: la oferta no lo exige).
    await navegar(page, `/clases/${clase.id}`);
    const instructores = page.getByRole('region', { name: 'Instructores' });
    await expect(instructores).toContainText('Sin instructor principal');
    await page.getByRole('button', { name: 'Cambiar los instructores adicionales' }).click();
    await page.getByRole('checkbox', { name: nombreDe(profesional) }).check();
    await page.getByRole('checkbox', { name: nombreDe(administradora) }).check();
    const reemplazo = respuestaDe(page, 'PUT', /\/clases\/\d+\/instructores$/);
    await page.getByRole('button', { name: 'Guardar los instructores' }).click();
    const respuestaReemplazo = await reemplazo;
    expect(respuestaReemplazo.status()).toBe(200);
    expect(respuestaReemplazo.request().postDataJSON()).toEqual({
      adicionales: [profesional.id, administradora.id].sort((a, b) => a - b),
    });
    await expect(page.getByText('La clase quedo con 2 instructores')).toBeVisible();
    await expect(instructores).toContainText('partes iguales entre los 2 instructores');

    // ---- 3. La asistencia, por la API: dos presentes; el cierre deja ausente a la tercera.
    const base = `/api/v1/consultorios/${centro.consultorioId}/clases/${clase.id}`;
    await api.exigir('POST', `${base}/inicio`, {});
    const [a, b] = clase.inscripciones;
    await api.exigir('POST', `${base}/asistencias/lote`, {
      items: [
        { inscripcionId: a.inscripcionId, resultado: 'PRESENTE' },
        { inscripcionId: b.inscripcionId, resultado: 'PRESENTE' },
      ],
    });
    await api.exigir('POST', `${base}/cierre`, {});

    // ---- 4. El borrador de la profesional, acotado a la oferta del test.
    await navegar(page, '/egresos/honorarios');
    await expect(
      page.getByRole('heading', { name: 'Liquidar honorarios por clase', level: 1 }),
    ).toBeVisible();
    const colaborador = page.getByLabel('Colaborador');
    await colaborador.locator('option').nth(1).waitFor({ state: 'attached' });
    await colaborador.selectOption({ label: nombreDe(profesional) });
    await page.getByLabel('Clases desde').fill(clase.fecha);
    await page.getByLabel('Clases hasta').fill(clase.fecha);
    await page.getByLabel('Servicio (opcional)').selectOption({ label: ofertaNombre });
    const borrador = respuestaDe(page, 'GET', /\/honorarios\/borrador$/);
    await page.getByRole('button', { name: 'Calcular el borrador' }).click();
    expect((await borrador).status()).toBe(200);
    const fila = page.getByRole('row').filter({ hasText: clase.titulo });
    await expect(fila).toContainText('2'); // presentes
    await expect(fila).toContainText('3.000,00'); // total de la clase
    await expect(fila).toContainText(/Parte [12] de 2/);
    await expect(fila).toContainText('1.500,00');

    // ---- 5. Confirmar: nace el egreso en borrador, imputado a la oferta.
    const confirmacion = respuestaDe(page, 'POST', /\/honorarios\/liquidaciones$/);
    await page.getByRole('button', { name: 'Confirmar la liquidación' }).click();
    const respuestaConfirmacion = await confirmacion;
    expect([200, 201]).toContain(respuestaConfirmacion.status());
    const pedido = respuestaConfirmacion.request().postDataJSON() as Record<string, unknown>;
    expect(pedido).toMatchObject({
      colaboradorMembershipId: profesional.id,
      ofertaId,
      claseIds: [clase.id],
      importeTotal: 1500,
    });
    expect(typeof pedido['idempotencyKey']).toBe('string');
    const liquidacion = (await respuestaConfirmacion.json()) as { id: number; egresoId: number };
    egresoCreado = liquidacion.egresoId;
    await expect(page.getByText(`Liquidación #${liquidacion.id} confirmada`)).toBeVisible();
    // La clase liquidada pasa a "no entra" en el borrador releido, con enlace a su egreso.
    await expect(page.getByText('Ya liquidada a este colaborador')).toBeVisible();

    await page.getByRole('link', { name: 'Ir al egreso' }).click();
    await expect(page).toHaveURL(new RegExp(`/egresos/${liquidacion.egresoId}$`));
    await expect(dato(page, 'Estado')).toContainText('Borrador');
    await expect(dato(page, 'Categoría')).toContainText('Honorarios profesionales');
    await expect(dato(page, 'Servicio u oferta')).toContainText(ofertaNombre);
    await expect(dato(page, 'Total')).toContainText('1.500,00');
    await expect(page.getByText('Nació de una liquidación de honorarios por clase')).toBeVisible();
    await expect(page.getByLabel('Importe total')).toBeDisabled();

    const egreso = await api.exigir<{ ofertaId: number; liquidacionHonorariosId: number }>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/egresos/${liquidacion.egresoId}`,
    );
    expect(egreso).toMatchObject({ ofertaId, liquidacionHonorariosId: liquidacion.id });

    // ---- 6. La liquidacion, con su snapshot por clase.
    await page.getByRole('link', { name: /Ver la liquidación #\d+/ }).click();
    await expect(page).toHaveURL(
      new RegExp(`/egresos/honorarios/liquidaciones/${liquidacion.id}$`),
    );
    await expect(dato(page, 'Estado')).toContainText('Vigente');
    await expect(page.getByRole('row').filter({ hasText: clase.titulo })).toContainText('1.500,00');
  });
});

test.describe('Servicio en el egreso contra el backend real (DP-39)', () => {
  let egresoCreado: number | null = null;

  test.beforeEach(async ({ page, centro }) => {
    await ingresar(page, centro);
  });

  test.afterEach(async ({ api, centro }) => {
    if (egresoCreado !== null) {
      await api.pedir(
        'POST',
        `/api/v1/consultorios/${centro.consultorioId}/egresos/${egresoCreado}/anulacion`,
        { motivo: 'Limpieza del E2E del servicio en el egreso' },
      );
      egresoCreado = null;
    }
  });

  test('alta imputada → la correccion la conserva → confirmado aparece en la rentabilidad', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro, { nombre: `Rentable E2E ${Date.now()}` });
    const sufijo = Date.now().toString(36);
    const concepto = `Insumos E2E ${sufijo}`;

    await navegar(page, '/egresos');
    await expect(page.getByRole('heading', { name: 'Egresos', level: 1 })).toBeVisible();
    const colaborador = page.getByLabel('Colaborador', { exact: true });
    await colaborador.locator('option').nth(1).waitFor({ state: 'attached' });
    await colaborador.selectOption({ index: 1 });
    await page.getByLabel('Servicio u oferta (opcional)').selectOption({ label: oferta.nombre });
    await page.getByLabel('Concepto').fill(concepto);
    await page.getByLabel('Importe total').fill('2000');
    await page.getByLabel('Tipo').fill('Factura C');
    await page.getByLabel('Número').fill(`E2E-${sufijo}`);
    const alta = respuestaDe(page, 'POST', /\/egresos$/);
    await page.getByRole('button', { name: 'Cargar el borrador' }).click();
    const creado = await alta;
    expect(creado.status()).toBe(201);
    expect(creado.request().postDataJSON()).toMatchObject({ ofertaId: oferta.id });
    egresoCreado = ((await creado.json()) as { id: number }).id;
    await expect(page).toHaveURL(new RegExp(`/egresos/${egresoCreado}$`));
    await expect(dato(page, 'Servicio u oferta')).toContainText(oferta.nombre);

    // La correccion reemplaza: tiene que volver a mandar la oferta, o el egreso queda sin imputar.
    await page.getByLabel('Concepto').fill(`${concepto} corregido`);
    const edicion = respuestaDe(page, 'PUT', /\/egresos\/\d+$/);
    await page.getByRole('button', { name: 'Guardar los cambios' }).click();
    const corregido = await edicion;
    expect(corregido.status()).toBe(200);
    expect(corregido.request().postDataJSON()).toMatchObject({ ofertaId: oferta.id });
    await expect(dato(page, 'Servicio u oferta')).toContainText(oferta.nombre);

    await page.getByRole('button', { name: 'Confirmar el egreso' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Egreso confirmado' })).toBeVisible();

    // El reporte de servicios lo resta de la rentabilidad de esa oferta.
    await navegar(page, '/reportes');
    await page
      .getByLabel('Reporte', { exact: true })
      .selectOption({ label: 'Ingresos por servicio' });
    const hoy = fechaLocal(centro.timezone);
    await page.getByLabel('Desde', { exact: true }).fill(hoy);
    await page.getByLabel('Hasta', { exact: true }).fill(hoy);
    const reporte = respuestaDe(page, 'GET', /\/reportes\/SERVICIOS$/);
    await page.getByRole('button', { name: 'Generar reporte' }).click();
    expect((await reporte).status()).toBe(200);
    const rentabilidad = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Rentabilidad por servicio', level: 2 }) });
    await expect(rentabilidad.getByRole('row').filter({ hasText: oferta.nombre })).toContainText(
      '2.000,00',
    );
    await expect(page.getByRole('heading', { name: 'Caja por servicio', level: 2 })).toBeVisible();
  });
});
