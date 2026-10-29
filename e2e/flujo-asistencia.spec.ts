import { Page } from '@playwright/test';

import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { ClaseSembrada, DIAS_ASISTENCIA, claseConInscriptos } from './support/sembrado-asistencia';
import { uriDeProblema } from './support/sembrado';

/**
 * E2E de la asistencia de clases (F9, AKINE-08.03) contra el backend REAL.
 *
 * <p>Clase grupal con cuatro inscriptas → clases del dia → iniciar → asistencia en lote → una
 * correccion con motivo (y el bloqueo sin motivo) → historial → cerrar. En el medio, una
 * inscripcion se cancela por la API con la pantalla abierta: el lote no es atomico y ese item
 * tiene que volver con su `problemType`, sin deshacer a los demas.
 *
 * <p><b>Lo que este E2E no recorre</b>: la derivacion clinica de un participante, que el backend no
 * publica (08.04 sin controller). El consumo de un pase lo recorre `flujo-pases.spec.ts`.
 */

const DETALLE = /\/clases\/\d+\/detalle-operativo$/;
const LOTE = /\/clases\/\d+\/asistencias\/lote$/;

function filaDe(page: Page, apellido: string) {
  return page.getByRole('row').filter({ hasText: apellido });
}

async function marcar(page: Page, apellido: string, resultado: string): Promise<void> {
  await filaDe(page, apellido)
    .getByRole('group', { name: /Asistencia de/ })
    .getByLabel(resultado, { exact: true })
    .check();
}

test.describe('Asistencia de clases contra el backend real', () => {
  let clase: ClaseSembrada;

  test.beforeEach(async ({ page, api, centro }) => {
    clase = await claseConInscriptos(api, centro, DIAS_ASISTENCIA.asistencia, 4);
    await ingresar(page, centro);
  });

  test('lista del dia, lote, correccion con motivo, historial y cierre', async ({
    page,
    api,
    centro,
  }) => {
    const [a, b, c, d] = clase.inscripciones;

    // ---- Clases del dia: se elige la fecha de la clase y se abre.
    await navegar(page, '/asistencia');
    await expect(
      page.getByRole('heading', { name: 'Asistencia a clases', level: 1 }),
    ).toBeVisible();
    await page.getByLabel('Fecha').fill(clase.fecha);
    const filaClase = page.getByRole('row').filter({ hasText: clase.titulo });
    await expect(filaClase).toContainText('Programada');
    await expect(filaClase).toContainText('4 de');
    const detalle = respuestaDe(page, 'GET', DETALLE);
    await filaClase.getByRole('link', { name: /Tomar asistencia/ }).click();
    expect((await detalle).status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(clase.titulo);

    // ---- Iniciar: sin clase en curso no se marca.
    await expect(page.getByRole('group', { name: /Asistencia de/ })).toHaveCount(0);
    const inicio = respuestaDe(page, 'POST', /\/clases\/\d+\/inicio$/);
    await page.getByRole('button', { name: 'Iniciar clase' }).click();
    expect((await inicio).status()).toBe(200);
    await expect(page.getByText('En curso', { exact: true })).toBeVisible();

    // ---- Con la pantalla abierta, otra persona cancela la inscripcion de D por la API.
    await api.exigir(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/clases/${clase.id}/inscripciones/${d.inscripcionId}/cancelacion`,
      { motivo: 'Aviso por telefono que no viene' },
    );

    // ---- Lote: presente, tarde, ausente, y D (que ya no tiene lugar).
    await marcar(page, a.persona.apellido, 'Presente');
    await marcar(page, b.persona.apellido, 'Llego tarde');
    await marcar(page, c.persona.apellido, 'Ausente');
    await marcar(page, d.persona.apellido, 'Presente');
    const lote = respuestaDe(page, 'POST', LOTE);
    await page.getByRole('button', { name: /Guardar asistencia \(4\)/ }).click();
    const respuestaLote = await lote;
    expect(respuestaLote.status()).toBe(200);
    const cuerpoLote = (await respuestaLote.json()) as {
      exitosos: number;
      fallidos: number;
      items: { inscripcionId: number; problemType?: string }[];
    };
    expect(cuerpoLote.exitosos).toBe(3);
    expect(cuerpoLote.fallidos).toBe(1);
    expect(cuerpoLote.items.find((i) => i.inscripcionId === d.inscripcionId)?.problemType).toBe(
      uriDeProblema('inscripcion-transicion-no-permitida'),
    );

    await expect(page.getByText('Se guardaron 3 participantes.')).toBeVisible();
    await expect(page.getByText(/1 no se pudieron guardar/)).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: d.persona.apellido })).toBeVisible();

    // La relectura del servidor: el lote parcial quedo escrito.
    await expect(page.getByText('Presentes: 2')).toBeVisible();
    await expect(page.getByText('Ausentes: 1')).toBeVisible();
    await expect(filaDe(page, d.persona.apellido)).toContainText('Sin lugar en la clase');

    // ---- Correccion: C pasa de ausente a presente. Sin motivo no sale nada.
    await marcar(page, c.persona.apellido, 'Presente');
    let salioUnLote = false;
    page.on('request', (r) => {
      if (r.method() === 'POST' && LOTE.test(new URL(r.url()).pathname)) {
        salioUnLote = true;
      }
    });
    await page.getByRole('button', { name: /Guardar asistencia \(1\)/ }).click();
    await expect(page.getByText('Escribi por que se corrige.')).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: 'correcciones sin motivo' }),
    ).toBeVisible();
    expect(salioUnLote).toBe(false);

    await filaDe(page, c.persona.apellido)
      .getByLabel('Motivo de la correccion')
      .fill('Llego despues de pasar lista');
    const correccion = respuestaDe(page, 'POST', LOTE);
    await page.getByRole('button', { name: /Guardar asistencia \(1\)/ }).click();
    const respuestaCorreccion = await correccion;
    expect(respuestaCorreccion.status()).toBe(200);
    expect(respuestaCorreccion.request().postDataJSON()).toEqual({
      items: [
        {
          inscripcionId: c.inscripcionId,
          resultado: 'PRESENTE',
          motivo: 'Llego despues de pasar lista',
        },
      ],
    });
    await expect(page.getByText('Presentes: 3')).toBeVisible();
    await expect(filaDe(page, c.persona.apellido)).toContainText('Corregida 1 vez');

    // ---- Historial: el resultado anterior no se perdio.
    await filaDe(page, c.persona.apellido)
      .getByRole('button', { name: /Historial/ })
      .click();
    const historial = page.getByRole('region', { name: /Historial de/ });
    await expect(historial.getByRole('listitem')).toHaveCount(2);
    await expect(historial).toContainText('Correccion');
    await expect(historial).toContainText('Ausente a Presente');
    await expect(historial).toContainText('Llego despues de pasar lista');

    // ---- Cierre: nadie quedo sin resolver, la clase queda realizada.
    const cierre = respuestaDe(page, 'POST', /\/clases\/\d+\/cierre$/);
    await page.getByRole('button', { name: 'Cerrar clase' }).click();
    expect((await cierre).status()).toBe(200);
    // UX-12: el resultado del cierre es un aviso global.
    await expect(
      page
        .getByRole('region', { name: 'Notificaciones', exact: true })
        .getByText('Clase cerrada', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Realizada', { exact: true })).toBeVisible();

    const final = await api.exigir<{ estado: string; presentes: number; ausentes: number }>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/clases/${clase.id}/detalle-operativo`,
    );
    expect(final).toMatchObject({ estado: 'REALIZADA', presentes: 3, ausentes: 0 });
  });
});

/**
 * U-39 y U-46 contra el backend real: en una oferta `POR_CLASE` la deuda nace con la asistencia y
 * la correccion a ausente la anula. La cuenta corriente muestra la deuda como "Clase del dd/mm" y
 * la ofrece anular como una de sesion (no es de venta). El campo de observaciones avisa que son
 * operativas (U-46 d).
 */
test.describe('Asistencia de una clase POR_CLASE contra el backend real (U-39)', () => {
  const PRECIO = 6000;
  let clase: ClaseSembrada;

  test.beforeEach(async ({ page, api, centro }) => {
    clase = await claseConInscriptos(api, centro, DIAS_ASISTENCIA.asistencia, 1, {
      esquemaCobro: 'POR_CLASE',
      precioBase: PRECIO,
      moneda: 'ARS',
    });
    await ingresar(page, centro);
  });

  test('asistencia → deuda en la cuenta corriente → correccion a ausente → deuda anulada', async ({
    page,
    api,
    centro,
  }) => {
    const [{ persona, inscripcionId }] = clase.inscripciones;
    const [anio, mes, dia] = clase.fecha.split('-');
    const concepto = `Clase del ${dia}/${mes}`;
    const deudasDe = () =>
      api.exigir<{ id: number; origen?: string; claseId?: number; estado: string }[]>(
        'GET',
        `/api/v1/consultorios/${centro.consultorioId}/obligaciones?personaId=${persona.id}`,
      );
    expect(anio).toHaveLength(4);

    // ---- Presente: nace la deuda de la clase. Las observaciones avisan que son operativas.
    await navegar(page, `/asistencia/${clase.id}`);
    await page.getByRole('button', { name: 'Iniciar clase' }).click();
    await expect(page.getByText('En curso', { exact: true })).toBeVisible();
    await marcar(page, persona.apellido, 'Presente');
    const observaciones = filaDe(page, persona.apellido).getByLabel('Observaciones (opcional)');
    await expect(observaciones).toHaveAccessibleDescription(/Operativas: no anotes datos de salud/);
    await observaciones.fill('Llego con el grupo de la tarde');
    const alta = respuestaDe(page, 'POST', LOTE);
    await page.getByRole('button', { name: /Guardar asistencia \(1\)/ }).click();
    const respuestaAlta = await alta;
    expect(respuestaAlta.status()).toBe(200);
    expect(respuestaAlta.request().postDataJSON()).toEqual({
      items: [
        { inscripcionId, resultado: 'PRESENTE', observaciones: 'Llego con el grupo de la tarde' },
      ],
    });
    const cuerpoAlta = (await respuestaAlta.json()) as {
      items: { resultado?: { devengoDeClase?: { efecto: string; obligacionId?: number } } }[];
    };
    const devengo = cuerpoAlta.items[0].resultado?.devengoDeClase;
    expect(devengo?.efecto).toBe('DEVENGADA');
    const resultado = page.getByRole('region', { name: 'Resultado' });
    await expect(resultado).toContainText('Deudas de la clase');
    await expect(resultado).toContainText(`${persona.apellido}`);
    await expect(resultado).toContainText('se genero la deuda de la clase por');

    const [deuda] = (await deudasDe()).filter((d) => d.origen === 'ASISTENCIA_CLASE');
    expect(deuda).toEqual(
      expect.objectContaining({
        claseId: clase.id,
        estado: 'PENDIENTE',
        id: devengo?.obligacionId,
      }),
    );

    // ---- La cuenta corriente la muestra con su concepto y la ofrece anular (no es de venta).
    await navegar(page, `/pacientes/${persona.id}/cuenta-corriente`);
    const fila = page.getByRole('row').filter({ hasText: concepto });
    await expect(fila).toContainText('Pendiente');
    await expect(fila.getByRole('button', { name: 'Anular' })).toBeVisible();
    await expect(fila.getByRole('link', { name: 'Anular desde los pases' })).toHaveCount(0);

    // ---- Correccion a ausente con motivo: la deuda se anula (no se borra).
    await navegar(page, `/asistencia/${clase.id}`);
    await marcar(page, persona.apellido, 'Ausente');
    await filaDe(page, persona.apellido)
      .getByLabel('Motivo de la correccion')
      .fill('Se marco presente por error');
    const correccion = respuestaDe(page, 'POST', LOTE);
    await page.getByRole('button', { name: /Guardar asistencia \(1\)/ }).click();
    const respuestaCorreccion = await correccion;
    expect(respuestaCorreccion.status()).toBe(200);
    const cuerpoCorreccion = (await respuestaCorreccion.json()) as {
      items: { resultado?: { devengoDeClase?: { efecto: string } } }[];
    };
    expect(cuerpoCorreccion.items[0].resultado?.devengoDeClase?.efecto).toBe('ANULADA');
    await expect(page.getByRole('region', { name: 'Resultado' })).toContainText(
      'se anulo la deuda de la clase',
    );

    const anulada = (await deudasDe()).find((d) => d.id === deuda.id);
    expect(anulada?.estado).toBe('ANULADA');
    await navegar(page, `/pacientes/${persona.id}/cuenta-corriente`);
    const filaAnulada = page.getByRole('row').filter({ hasText: concepto });
    await expect(filaAnulada).toContainText('Anulada');
    await expect(filaAnulada).toContainText('Se marco presente por error');
    await expect(filaAnulada.getByRole('button', { name: 'Anular' })).toHaveCount(0);
  });
});
