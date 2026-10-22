import { test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { ingresar, navegar, problemaDe, respuestaDe } from './support/agenda-real';
import {
  CentroPropio,
  cerrarCentroPropio,
  dato,
  expect,
  sembrarCentroPropio,
} from './support/centro-propio';
import { abrirLaCaja, cajaAbierta, dejarLaCajaCerrada, uriDeProblema } from './support/sembrado';

/**
 * E2E de los egresos de la sede (F-5, M22) cuando otra computadora los cambia mientras la pantalla
 * los muestra, contra el backend real.
 *
 * <p>`flujo-caja` recorre el camino feliz (alta, confirmacion, pago, anulacion del pago). Lo que
 * queda es lo que solo aparece con dos personas trabajando a la vez sobre el mismo egreso:
 *
 * <ul>
 *   <li>corregir un borrador con una version vieja: `concurrent-modification`, sin pisar lo del
 *       otro;</li>
 *   <li>anular un egreso que, mientras se miraba, recibio un pago: `egreso-con-pagos`. La pantalla
 *       escondia el boton cuando habia pagos; con la pantalla vieja el boton esta, y quien frena es
 *       el servidor;</li>
 *   <li>y la carrera de verdad, un pago y una anulacion al mismo tiempo: nunca puede quedar un
 *       egreso ANULADO con un pago vigente (la plata salio por un compromiso que ya no existe).</li>
 * </ul>
 *
 * <p>Centro propio (`support/centro-propio.ts`): los pagos mueven la caja de la sede.
 */
test.describe.configure({ mode: 'default' });

/**
 * Sin comprobante el egreso no se confirma (`egreso-sin-comprobante`), y el comprobante tiene que
 * ser UNICO por egreso: el backend rechaza con 409 `egreso-comprobante-duplicado` un comprobante
 * de ese beneficiario que ya este cargado en un egreso no anulado (`uk_egreso_comprobante`).
 *
 * <p>Con un numero fijo, la carrera de abajo dependia de quien la ganara: cuando ganaba el pago, el
 * egreso quedaba PAGADO —resultado legitimo— y retenia la factura, asi que el alta de la vuelta
 * siguiente moria con ese 409 antes de llegar a la carrera. Solo pasaba si la anulacion ganaba las
 * once primeras vueltas, y por eso salia flaky (el reintento siembra otro centro y vuelve a tirar).
 */
function comprobanteUnico(): { comprobanteTipo: string; comprobanteNumero: string } {
  const numero = parseInt(randomUUID().replace(/-/g, '').slice(0, 7), 16) % 100_000_000;
  return {
    comprobanteTipo: 'Factura C',
    comprobanteNumero: `0001-${String(numero).padStart(8, '0')}`,
  };
}

interface Egreso {
  readonly id: number;
  readonly version: number;
  readonly estado: string;
  readonly concepto: string;
  readonly saldoPendiente: number;
  readonly comprobanteTipo?: string;
  readonly comprobanteNumero?: string;
  readonly pagos?: readonly { readonly id: number; readonly estado: string }[];
}

test.describe('Egresos con dos operadores a la vez contra el backend real', () => {
  let propio: CentroPropio;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    propio = await sembrarCentroPropio('egreso');
  });

  test.beforeEach(async () => {
    await dejarLaCajaCerrada(propio.api, propio.centro);
    await abrirLaCaja(propio.api, propio.centro, 100_000);
  });

  test.afterAll(async () => {
    if (propio !== undefined) {
      await dejarLaCajaCerrada(propio.api, propio.centro);
    }
    await cerrarCentroPropio(propio);
  });

  test('version vieja al corregir, y anular con un pago que llego mientras se miraba', async ({
    page,
  }) => {
    test.slow();
    const { api, centro } = propio;
    const sede = `/api/v1/consultorios/${centro.consultorioId}`;
    const egreso = await altaDeEgreso(propio, 'Alquiler del consultorio', 3000);

    await ingresar(page, centro);
    await navegar(page, `/egresos/${egreso.id}`);
    await expect(page.getByRole('heading', { name: egreso.concepto })).toBeVisible();
    await expect(dato(page, 'Estado')).toContainText('Borrador');

    // --- 1. Otra computadora corrige el borrador; la pantalla guarda con la version vieja --------
    await api.exigir('PUT', `${sede}/egresos/${egreso.id}`, {
      categoria: 'ALQUILER',
      concepto: `${egreso.concepto} (corregido)`,
      importeTotal: 3200,
      comprobanteTipo: egreso.comprobanteTipo,
      comprobanteNumero: egreso.comprobanteNumero,
      version: egreso.version,
    });
    await page.locator('#edicion-concepto').fill(`${egreso.concepto} (pisado)`);
    const vieja = respuestaDe(page, 'PUT', /\/egresos\/\d+$/);
    await page.getByRole('button', { name: 'Guardar los cambios' }).click();
    const rechazo = await vieja;
    expect(rechazo.status()).toBe(409);
    expect((await problemaDe(rechazo)).type).toBe(uriDeProblema('concurrent-modification'));
    const releido = await api.exigir<Egreso>('GET', `${sede}/egresos/${egreso.id}`);
    expect(releido.concepto, 'lo del otro operador no se piso').toBe(
      `${egreso.concepto} (corregido)`,
    );
    expect(releido.version).toBeGreaterThan(egreso.version);

    // Recargar trae lo del otro, y desde ahi se confirma.
    await page.reload();
    await expect(
      page.getByRole('heading', { name: `${egreso.concepto} (corregido)` }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar el egreso' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Egreso confirmado' })).toBeVisible();
    await expect(dato(page, 'Saldo pendiente')).toContainText('3.200,00');

    // --- 2. Mientras la pantalla lo muestra sin pagos, otra computadora le registra uno -----------
    await expect(page.getByRole('button', { name: 'Anular el egreso' })).toBeVisible();
    await pagar(propio, egreso.id, 500);
    await page.getByRole('button', { name: 'Anular el egreso' }).click();
    await page.getByLabel('Motivo de la anulación').fill('Se cargo por duplicado');
    const anulacion = respuestaDe(page, 'POST', /\/egresos\/\d+\/anulacion$/);
    await page.getByRole('button', { name: 'Anular el egreso', exact: true }).last().click();
    const conPagos = await anulacion;
    expect(conPagos.status()).toBe(409);
    expect((await problemaDe(conPagos)).type).toBe(uriDeProblema('egreso-con-pagos'));
    expect((await api.exigir<Egreso>('GET', `${sede}/egresos/${egreso.id}`)).estado).not.toBe(
      'ANULADO',
    );

    // Recargado, la pantalla dice por que no se puede y ofrece la salida: anular el pago primero.
    await page.reload();
    await expect(dato(page, 'Saldo pendiente')).toContainText('2.700,00');
    await expect(page.getByText(/Tiene pagos vigentes/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Anular el egreso' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Anular el pago/ }).click();
    await page.getByLabel('Motivo de la anulación').fill('Pago cargado por error');
    await page.getByRole('button', { name: 'Anular el pago', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Pago anulado' })).toBeVisible();

    await page.getByRole('button', { name: 'Anular el egreso' }).click();
    await page.getByLabel('Motivo de la anulación').fill('Se cargo por duplicado');
    await page.getByRole('button', { name: 'Anular el egreso', exact: true }).last().click();
    await expect(page.getByRole('status').filter({ hasText: 'Egreso anulado' })).toBeVisible();
    await expect(dato(page, 'Estado')).toContainText('Anulado');
    await expect(page.getByRole('heading', { name: 'Registrar un pago' })).toHaveCount(0);
  });

  /*
   * La carrera de verdad: un pago en efectivo y la anulacion del mismo egreso a la vez. Hasta
   * appKine-api #136 el pago (UPDATE nativo de `descontarSaldo`, sin `@Version`) y la anulacion
   * (lectura + `@Version`) no se veian: en 9 de 12 carreras ganaban los dos y el egreso quedaba
   * ANULADO con un pago EFECTIVO vigente. Hoy `anular` toma el egreso con `FOR UPDATE`, asi que las
   * dos operaciones se serializan y exactamente una gana:
   *   - gana el pago (201): la anulacion recibe 409 `egreso-con-pagos`;
   *   - gana la anulacion (200): el pago recibe 409 `egreso-no-pagable`.
   * Nunca queda un egreso ANULADO con un pago vigente.
   */
  test('un pago y una anulacion a la vez: gana uno, el otro recibe 409, y nunca queda anulado con pago vigente', async () => {
    test.slow();
    const { api, centro } = propio;
    const sede = `/api/v1/consultorios/${centro.consultorioId}`;
    const incoherentes: string[] = [];
    const cajaAntes = (await cajaAbierta(api, centro))?.saldoTeorico;
    let pagosVigentesDeAnulados = 0;

    for (let intento = 0; intento < 12; intento++) {
      const egreso = await altaDeEgreso(propio, `Insumos ${intento}`, 1000);
      await api.exigir('POST', `${sede}/egresos/${egreso.id}/confirmacion`);

      // En efectivo: si la carrera la ganan los dos, la plata sale del cajon por un egreso anulado.
      const [pago, anulacion] = await Promise.all([
        api.pedir('POST', `${sede}/egresos/${egreso.id}/pagos`, {
          importe: 1000,
          medio: 'EFECTIVO',
          idempotencyKey: randomUUID(),
        }),
        api.pedir('POST', `${sede}/egresos/${egreso.id}/anulacion`, {
          motivo: 'Carrera sintetica de los E2E',
        }),
      ]);
      // Exactamente uno gana; el otro pierde con el 409 de negocio que le corresponde, nunca un 500.
      const pagoTexto = await pago.text();
      const anulacionTexto = await anulacion.text();
      const resumen = `pago ${pago.status()} ${pagoTexto} | anulacion ${anulacion.status()} ${anulacionTexto}`;
      const ganoElPago = pago.status() === 201 && anulacion.status() === 409;
      const ganoLaAnulacion = anulacion.status() === 200 && pago.status() === 409;
      expect(ganoElPago || ganoLaAnulacion, `exactamente uno gana: ${resumen}`).toBe(true);
      const tipoPerdedor = (JSON.parse(ganoElPago ? anulacionTexto : pagoTexto) as { type: string })
        .type;
      expect(tipoPerdedor, resumen).toBe(
        uriDeProblema(ganoElPago ? 'egreso-con-pagos' : 'egreso-no-pagable'),
      );

      const final = await api.exigir<Egreso>('GET', `${sede}/egresos/${egreso.id}`);
      const vigentes = (final.pagos ?? []).filter((p) => p.estado !== 'ANULADO');
      if (final.estado === 'ANULADO' && vigentes.length > 0) {
        incoherentes.push(
          `egreso ${egreso.id}: pago ${pago.status()} ${await pago.text()} | anulacion ` +
            `${anulacion.status()} | final estado=${final.estado} saldoPendiente=` +
            `${final.saldoPendiente} pagosVigentes=${vigentes.map((p) => p.id).join(',')}`,
        );
        pagosVigentesDeAnulados += vigentes.length;
        // La unica salida que ofrece el producto para devolver la plata: anular el pago.
        const devolver = await api.pedir(
          'POST',
          `${sede}/egresos/${egreso.id}/pagos/${vigentes[0].id}/anulacion`,
          { motivo: 'Devolver la plata del egreso anulado' },
        );
        incoherentes.push(
          `  anular el pago ${vigentes[0].id}: ${devolver.status()} ${await devolver.text()}`,
        );
      }
    }
    const cajaDespues = (await cajaAbierta(api, centro))?.saldoTeorico;
    if (incoherentes.length > 0) {
      incoherentes.push(
        `caja: antes ${cajaAntes}, despues ${cajaDespues}; pagos vigentes de egresos anulados: ` +
          `${pagosVigentesDeAnulados}`,
      );
    }
    expect(incoherentes, incoherentes.join('\n')).toEqual([]);
  });
});

async function altaDeEgreso(
  propio: CentroPropio,
  concepto: string,
  importeTotal: number,
): Promise<Egreso> {
  const { api, centro } = propio;
  return api.exigir<Egreso>('POST', `/api/v1/consultorios/${centro.consultorioId}/egresos`, {
    categoria: 'ALQUILER',
    concepto: `${concepto} ${randomUUID().slice(0, 6)}`,
    importeTotal,
    moneda: 'ARS',
    tipoBeneficiario: 'EXTERNO',
    beneficiarioNombre: 'Inmobiliaria Sintetica SRL',
    ...comprobanteUnico(),
    idempotencyKey: randomUUID(),
  });
}

function pagar(propio: CentroPropio, egresoId: number, importe: number): Promise<unknown> {
  const { api, centro } = propio;
  return api.exigir(
    'POST',
    `/api/v1/consultorios/${centro.consultorioId}/egresos/${egresoId}/pagos`,
    {
      importe,
      medio: 'TRANSFERENCIA',
      referencia: `TRF-${randomUUID().slice(0, 8)}`,
      idempotencyKey: randomUUID(),
    },
  );
}
