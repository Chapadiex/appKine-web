import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import {
  crearConvenio,
  crearFinanciador,
  crearPersona,
  darCobertura,
  fechaLocal,
  fijarPrecio,
  sumarDias,
} from './support/sembrado';
import { ofertaConPractica } from './support/sembrado-pantallas-098';

/**
 * E2E de coberturas y aranceles por oferta (B-3, B-5) contra el backend REAL.
 *
 * <p>Un convenio con arancel GENERAL para `KIN_SESION` (cargado por la API) y una oferta que declara
 * esa practica. Por pantalla:
 * <ol>
 *   <li>la grilla de aranceles del convenio carga el arancel PROPIO de la oferta;</li>
 *   <li>el Paciente 360 muestra la cobertura vigente con el afiliado enmascarado;</li>
 *   <li>Coberturas del paciente, consultada por oferta, sugiere la cobertura con el arancel propio y
 *   el precio particular del dia;</li>
 *   <li>Consultar un arancel da el propio con la oferta y el general sin ella.</li>
 * </ol>
 * Lo que se afirma es la resolucion del servidor (que arancel manda), no solo lo que la pantalla
 * pinta: ningun test unitario podia probar que el propio le gana al general.
 */
const GENERAL = { total: 10000, financiador: 7000, coseguro: 3000 };
const PROPIO = { total: 12000, financiador: 9000, coseguro: 3000 };
const PARTICULAR = 8000;

/** `$ 12.000,00` sin depender del espacio que pone `Intl` entre el signo y el numero. */
function pesos(importe: number): RegExp {
  const numero = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(importe);
  return new RegExp(numero.replace(/\./g, '\\.'));
}

test.describe('Coberturas y aranceles por oferta contra el backend real', () => {
  test('el arancel propio de la oferta manda en el 360, en coberturas y en la consulta', async ({
    page,
    api,
    centro,
  }) => {
    test.slow();
    const sede = `/api/v1/consultorios/${centro.consultorioId}`;
    const desde = sumarDias(fechaLocal(centro.timezone), -30);
    const { oferta, practicaId } = await ofertaConPractica(api, centro, GENERAL.total);
    await fijarPrecio(api, centro, oferta, PARTICULAR);
    const financiador = await crearFinanciador(api, desde);
    const convenio = await crearConvenio(api, centro, financiador, desde);
    await api.exigir('POST', `${sede}/convenios/${convenio.id}/aranceles`, {
      practicaId,
      importeTotal: GENERAL.total,
      importeFinanciador: GENERAL.financiador,
      coseguro: GENERAL.coseguro,
      vigenciaDesde: desde,
    });
    const persona = await crearPersona(api);
    await darCobertura(api, persona, financiador, desde);
    const planes = await api.exigir<
      { id: number; nombre: string }[] | { content: { id: number; nombre: string }[] }
    >('GET', `/api/v1/financiadores/${financiador.id}/planes`);
    const plan = (Array.isArray(planes) ? planes : planes.content).find(
      (p) => p.id === financiador.planId,
    )!.nombre;

    await ingresar(page, centro);

    // --- 1. Arancel propio de la oferta, por la grilla del convenio --------------------------
    await navegar(page, `/contratacion/convenios/${convenio.id}/aranceles`);
    await expect(
      page.getByRole('heading', { name: `Aranceles de ${convenio.nombre}`, level: 1 }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cargar un arancel' }).click();
    await page.getByLabel('Práctica').selectOption({ value: String(practicaId) });
    await page.getByLabel('Oferta (opcional)').selectOption({ label: `Solo en ${oferta.nombre}` });
    await page.getByLabel('Importe total').fill(String(PROPIO.total));
    await page.getByLabel('Pone el financiador').fill(String(PROPIO.financiador));
    await page.getByLabel('Coseguro del paciente').fill(String(PROPIO.coseguro));
    await page.getByLabel('Vigente desde').fill(desde);
    const alta = respuestaDe(page, 'POST', /\/convenios\/\d+\/aranceles$/);
    await page.getByRole('button', { name: 'Cargar arancel' }).click();
    const creado = await alta;
    expect(creado.status(), await creado.text()).toBe(201);
    expect(((await creado.json()) as { ofertaId?: number }).ofertaId).toBe(oferta.id);
    await expect(
      page.getByRole('region', { name: 'Aranceles del convenio' }).getByRole('row'),
    ).toHaveCount(3);

    // --- 2. Paciente 360: la cobertura vigente, con el afiliado enmascarado ------------------
    await navegar(page, `/pacientes/${persona.id}`);
    const coberturas = page.getByRole('region', { name: 'Coberturas', exact: true });
    await expect(coberturas.getByText(`${financiador.nombre} — ${plan}`)).toBeVisible();
    await expect(coberturas.getByText('Principal')).toBeVisible();
    await expect(coberturas.getByText(/^Afiliado /)).toBeVisible();
    await expect(coberturas.getByText(/AF-\d/)).toHaveCount(0);

    // --- 3. Coberturas del paciente, por oferta ----------------------------------------------
    await coberturas.getByRole('link', { name: 'Ver coberturas del paciente' }).click();
    await expect(page).toHaveURL(new RegExp(`/pacientes/${persona.id}/coberturas$`));
    await page.getByRole('button', { name: 'Consultar por oferta' }).click();
    const resolucion = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith('/cobertura-aplicable') &&
        new URL(r.url()).searchParams.get('ofertaId') === String(oferta.id),
    );
    await page.getByLabel('Oferta', { exact: true }).selectOption({ label: oferta.nombre });
    expect((await resolucion).status()).toBe(200);
    await expect(
      page.getByText(`Sugerencia: atender con cobertura — ${financiador.nombre}`),
    ).toBeVisible();
    await expect(page.getByText(/Precio particular del dia:/)).toContainText(pesos(PARTICULAR));
    const aplica = page.locator('.lista-cobertura li').filter({ hasText: financiador.nombre });
    await expect(aplica).toContainText(pesos(PROPIO.total));
    await expect(aplica).toContainText('Arancel propio de esta oferta en el convenio');

    // --- 4. Consultar un arancel: con la oferta el propio, sin ella el general ---------------
    await navegar(page, '/contratacion/arancel-efectivo');
    await page.getByLabel('Financiador').selectOption({ value: String(financiador.id) });
    await page.getByLabel('Plan').selectOption({ value: String(financiador.planId) });
    await page.getByLabel('Práctica').selectOption({ value: String(practicaId) });
    await page.getByLabel('Oferta (opcional)').selectOption({ label: oferta.nombre });
    await page.getByRole('button', { name: 'Consultar' }).click();
    const resultado = page.getByRole('region', { name: /, el / });
    // Contratacion redacta "ARS 12000.00" (`etiquetas-de-contracting`), no el formato local de billing.
    await expect(resultado).toContainText(`ARS ${PROPIO.total.toFixed(2)}`);
    await expect(resultado).toContainText(`Arancel propio de la oferta ${oferta.nombre}.`);

    await page.getByLabel('Oferta (opcional)').selectOption({ value: '' });
    await page.getByRole('button', { name: 'Consultar' }).click();
    await expect(resultado).toContainText(`ARS ${GENERAL.total.toFixed(2)}`);
    await expect(resultado).not.toContainText('Arancel propio');
  });
});
