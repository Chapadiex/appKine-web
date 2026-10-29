import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { nonce } from './support/akine';
import { diaDeTrabajo } from './support/sembrado';
import {
  DIAS_CONFIGURACION,
  paginaDePlataforma,
  plataformaDisponible,
} from './support/sembrado-configuracion';
import { abrirAcciones, abrirFiltros } from './support/filtros';

/**
 * E2E de servicios y ofertas (M08, AKINE-02.06, 02.07 y B-3) contra el backend REAL: la plataforma
 * da de alta un servicio del catalogo global, el centro le arma su oferta, habilita a su
 * profesional y le carga un precio particular; despues la plataforma da de baja el servicio y la
 * oferta del centro SIGUE operando.
 *
 * <p>"La baja de un servicio global no cascadea" es una regla fijada desde 02.06 y nunca se habia
 * probado de punta a punta: la baja la hace una cuenta y quien la sufriria es otra.
 *
 * <p>El servicio es propio del test y queda dado de baja: el sembrado de `agenda-setup` toma el
 * PRIMER servicio activo del catalogo, asi que uno dado de baja no le cambia nada a las corridas
 * siguientes. Necesita la cuenta de plataforma del bootstrap de DP-14; sin ella, se saltea.
 */
test.describe('Servicios y ofertas contra el backend real', () => {
  test('servicio global, oferta con profesional y precio, y la baja del servicio no cascadea', async ({
    page,
    browser,
    api,
    centro,
  }) => {
    // Dos cuentas, dos navegadores y una docena de vueltas al backend: los 90 s del proyecto no
    // alcanzan cuando corre al lado de otros specs.
    test.setTimeout(180_000);
    const motivo = await plataformaDisponible();
    test.skip(motivo !== null, motivo ?? '');

    const sufijo = nonce();
    const nombreDelServicio = `Drenaje E2E ${sufijo}`;
    const nombreDeLaOferta = `Drenaje de la sede ${sufijo}`;

    let ofertaId = 0;
    let servicioId: number;
    const plataforma = await paginaDePlataforma(browser);
    try {
      // --- La plataforma da de alta el servicio global ---
      await navegar(plataforma, '/servicios/catalogo');
      await plataforma.getByRole('button', { name: 'Nuevo servicio' }).click();
      await plataforma.getByLabel('Código', { exact: true }).fill(`E2E_SRV_${sufijo}`);
      await plataforma.getByLabel('Nombre', { exact: true }).fill(nombreDelServicio);
      await plataforma.getByLabel('Naturaleza').selectOption('TERAPEUTICO');
      await plataforma.getByLabel('Modalidad por defecto').selectOption('INDIVIDUAL');
      const altaDelServicio = respuestaDe(plataforma, 'POST', /\/servicios$/);
      await plataforma.getByRole('button', { name: 'Dar de alta', exact: true }).click();
      const servicio = await altaDelServicio;
      expect(servicio.status(), await servicio.text()).toBe(201);
      servicioId = ((await servicio.json()) as { id: number }).id;
      await expect(
        plataforma.getByText('El servicio quedo dado de alta en el catalogo global'),
      ).toBeVisible();

      // --- El centro arma su oferta sobre ese servicio ---
      await ingresar(page, centro);
      await navegar(page, '/servicios/ofertas');
      await page.getByRole('button', { name: 'Publicar un servicio en la sede' }).click();
      await page.getByLabel('Servicio del catalogo').selectOption(String(servicioId));
      await page.getByLabel('Nombre comercial').fill(nombreDeLaOferta);
      await page.getByLabel('Duración (minutos)').fill('30');
      await page.getByLabel('Requiere espacio o box').uncheck();
      const altaDeLaOferta = respuestaDe(page, 'POST', /\/consultorios\/\d+\/ofertas$/);
      await page.getByRole('button', { name: 'Dar de alta', exact: true }).click();
      const oferta = await altaDeLaOferta;
      expect(oferta.status(), await oferta.text()).toBe(201);
      ofertaId = ((await oferta.json()) as { id: number }).id;
      await expect(page.getByText('La oferta quedo dada de alta en esta sede.')).toBeVisible();

      await abrirFiltros(page);
      await page.getByLabel('Servicio', { exact: true }).selectOption(String(servicioId));
      const fila = page.getByRole('row').filter({ hasText: nombreDeLaOferta });
      await expect(fila).toBeVisible();

      // --- Habilitacion del profesional ---
      await abrirAcciones(fila);
      await fila.getByRole('link', { name: 'Habilitaciones' }).click();
      await expect(
        page.getByRole('heading', { name: 'Habilitaciones de la oferta', level: 1 }),
      ).toBeVisible();
      await page.getByRole('checkbox', { name: centro.profesional.nombre }).check();
      const habilitacion = respuestaDe(page, 'PUT', /\/habilitaciones\/profesionales$/);
      await page.getByRole('button', { name: 'Guardar los profesionales' }).click();
      expect((await habilitacion).status()).toBe(200);
      await expect(page.getByText('Guardamos la configuración de la oferta.')).toBeVisible();

      // --- Precio particular desde hoy ---
      await navegar(page, `/servicios/ofertas/${ofertaId}/precios`);
      await page.getByRole('button', { name: 'Cargar un precio' }).click();
      await page.getByLabel('Importe').fill('12500');
      // La oferta no tiene precio de lista: la moneda no tiene de donde heredarse y se escribe.
      await expect(page.getByLabel('Moneda', { exact: true })).toHaveValue('');
      await page.getByLabel('Moneda', { exact: true }).fill('ARS');
      const precio = respuestaDe(page, 'POST', /\/precios-particulares$/);
      await page.getByRole('button', { name: 'Cargar precio' }).click();
      const cargado = await precio;
      expect(cargado.status(), await cargado.text()).toBe(201);
      await expect(page.getByText('Rige hoy')).toBeVisible();

      // --- La plataforma da de baja el servicio ---
      // La busqueda relee el listado despues del debounce, y mientras carga el panel lateral de la
      // baja se desmonta: abierto antes de esa respuesta, vuelve vacio y el motivo se pierde.
      const busqueda = respuestaDe(plataforma, 'GET', /\/servicios$/);
      await plataforma.getByLabel('Buscar').fill(nombreDelServicio);
      await busqueda;
      const filaDelServicio = plataforma.getByRole('row').filter({ hasText: nombreDelServicio });
      await abrirAcciones(filaDelServicio);
      await filaDelServicio.getByRole('button', { name: 'Dar de baja' }).click();
      const panelDeBaja = plataforma
        .locator('form')
        .filter({ has: plataforma.locator('#baja-servicio-motivo') });
      await panelDeBaja.getByLabel('Motivo de la baja').fill('Se reemplaza por otro servicio');
      const baja = respuestaDe(plataforma, 'DELETE', new RegExp(`/servicios/${servicioId}$`));
      await panelDeBaja.getByRole('button', { name: 'Dar de baja' }).click();
      expect((await baja).ok()).toBe(true);
      await abrirFiltros(plataforma);
      await plataforma.getByLabel('Mostrar').selectOption('INACTIVO');
      await expect(
        plataforma
          .getByRole('row')
          .filter({ hasText: nombreDelServicio })
          .getByText('Dado de baja'),
      ).toBeVisible();
    } finally {
      await plataforma.context().close();
    }

    // --- La oferta del centro sigue: activa, con su profesional, su precio y sus turnos ---
    const activas = await api.exigir<{ id: number; estado: string }[]>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/ofertas?servicioId=${servicioId}`,
    );
    expect(activas.find((o) => o.id === ofertaId)?.estado).toBe('ACTIVO');
    const precios = await api.exigir<{ importe: number }[]>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/ofertas/${ofertaId}/precios-particulares`,
    );
    expect(precios.map((p) => Number(p.importe))).toContain(12500);
    const { slots } = await diaDeTrabajo(
      api,
      centro,
      ofertaId,
      DIAS_CONFIGURACION.servicioSinCascada,
    );
    expect(slots[0].profesionalId).toBe(centro.profesional.membershipId);

    await navegar(page, '/servicios/ofertas');
    await abrirFiltros(page);
    await page.getByLabel('Mostrar').selectOption('ACTIVO');
    await expect(page.getByRole('row').filter({ hasText: nombreDeLaOferta })).toBeVisible();
  });
});
