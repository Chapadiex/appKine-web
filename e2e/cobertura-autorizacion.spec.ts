import { Page, expect, test } from '@playwright/test';

import { emailUnico, nonce } from './support/akine';
import { cuentaActiva, esperarProblema, ingresarCon } from './support/cuentas';
import { PASSWORD } from './support/akine';
import { ApiAkine } from './support/sembrado';

/**
 * Persona → perfil de paciente → cobertura → orden medica → autorizacion → vencimiento, por
 * PANTALLA y contra el backend REAL (AKINE B-6).
 *
 * <p>Lo unico que se siembra por la API es lo que no es de esta vertical y ya tiene sus propias
 * pantallas: el financiador con su plan (contratacion, M16) y la especialidad con su practica
 * (catalogo clinico, M06). Todo lo del paciente se carga desde las pantallas de `person`.
 *
 * <h2>Como se prueba un vencimiento sin esperar a que pase el tiempo</h2>
 *
 * <p>VENCIDA no es un estado guardado: el backend la calcula al leer, contra el dia de hoy
 * (`Autorizacion.vencidaEl`). Asi que el vencimiento se produce como lo produce la realidad —la
 * fecha de fin queda atras— de dos maneras: una autorizacion cargada con su vigencia ya terminada,
 * y una vigente a la que se le corrige el fin a ayer. En los dos casos la pantalla tiene que dejar
 * de decir "Habilita a atender" sin que nadie cambie su estado.
 *
 * <p>"Hoy" es la fecha UTC: es la que usa el backend (`LocalDate.now()` en un contenedor UTC), y
 * es contra ella que calcula `diasParaVencer`.
 */

/** `YYYY-MM-DD` UTC, `dias` despues de hoy. */
function dia(dias: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Fila de la tabla de autorizaciones por su numero.
 *
 * <p>Por la celda que EMPIEZA con el numero: el panel de correccion es otra fila de la misma tabla
 * y su celda dice "Corregir la autorizacion AUT-...".
 */
function filaDeAutorizacion(page: Page, numero: string) {
  return page
    .getByRole('table', { name: /autorizacion\(es\) del paciente/ })
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: new RegExp(`^${numero}(\\s|$)`) }) });
}

interface Montaje {
  readonly email: string;
  readonly financiador: string;
  readonly plan: string;
  readonly practica: string;
}

/** El centro, con un financiador, un plan que pide autorizacion y una practica propia. */
async function montarCentro(): Promise<Montaje> {
  const sufijo = nonce();
  const email = emailUnico('b6.admin');
  await cuentaActiva({ email, organizationName: `Centro Coberturas ${sufijo}` });

  const api = await ApiAkine.como(email);
  try {
    const financiador = `Obra Social E2E ${sufijo}`;
    const { id: financiadorId } = await api.exigir<{ id: number }>(
      'POST',
      '/api/v1/financiadores',
      { codigo: `OS${sufijo}`.toUpperCase(), nombre: financiador, tipo: 'OBRA_SOCIAL' },
    );
    const plan = `Plan 210 ${sufijo}`;
    await api.exigir('POST', `/api/v1/financiadores/${financiadorId}/planes`, {
      codigo: `P${sufijo}`.toUpperCase(),
      nombre: plan,
      vigenciaDesde: dia(-365),
      requiereAutorizacion: true,
    });

    const { id: especialidadId } = await api.exigir<{ id: number }>(
      'POST',
      '/api/v1/catalogos/especialidades',
      { codigo: `KIN${sufijo}`.toUpperCase(), name: `Kinesiologia ${sufijo}` },
    );
    const practica = `Rehabilitacion de rodilla ${sufijo}`;
    await api.exigir('POST', '/api/v1/catalogos/practicas', {
      codigo: `REH${sufijo}`.toUpperCase(),
      name: practica,
      especialidadId,
    });

    return { email, financiador, plan, practica };
  } finally {
    await api.cerrar();
  }
}

test.describe('Cobertura, orden y autorizacion de un paciente (B-6)', () => {
  test('persona -> perfil -> cobertura -> orden -> autorizacion, y lo que la pantalla muestra al vencer', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { email, financiador, plan, practica } = await montarCentro();
    const apellido = `Sintetico${nonce()}`;

    await ingresarCon(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/organizacion/);

    // --- 1. Persona: alta en el padron ----------------------------------------------------
    await page.goto('/pacientes');
    await page.getByRole('button', { name: 'Dar de alta una persona' }).click();
    const alta = page.getByRole('region', { name: 'Nueva persona' });
    await alta.getByLabel('Apellido').fill(apellido);
    await alta.getByLabel('Nombre', { exact: true }).fill('Luis');
    await alta.getByRole('button', { name: 'Dar de alta', exact: true }).click();

    const filaPersona = page.getByRole('row').filter({ hasText: apellido });
    await expect(filaPersona).toBeVisible();
    const enlaceFicha = filaPersona.getByRole('link', { name: 'Ver ficha' });
    const personaId = /\/pacientes\/(\d+)/.exec(
      (await enlaceFicha.getAttribute('href')) ?? '',
    )?.[1];
    expect(personaId, 'la fila enlaza a la ficha de la persona').toBeDefined();

    // --- 2. Sin perfil de paciente no hay cobertura: el backend lo dice con su tipo --------
    await page.goto(`/pacientes/${personaId}/coberturas`);
    await page.getByRole('button', { name: 'Agregar una cobertura' }).click();
    const sinPerfil = page.getByRole('region', { name: 'Nueva cobertura' });
    await sinPerfil.getByLabel('Vigente desde').fill(dia(-30));
    const rechazo = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/personas\/\d+\/coberturas$/.test(r.url()),
    );
    await sinPerfil.getByRole('button', { name: 'Agregar cobertura' }).click();
    await esperarProblema(
      await rechazo,
      409,
      'https://akine.app/problems/persona-sin-perfil-paciente',
    );
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Ir a la ficha para activar el perfil' }),
    ).toBeVisible();

    // --- 3. Perfil de paciente, desde el padron --------------------------------------------
    await page.goto('/pacientes');
    await filaPersona.getByRole('button', { name: 'Activar perfil de paciente' }).click();
    await page.getByRole('button', { name: 'Activar perfil', exact: true }).click();
    await expect(
      filaPersona.getByRole('button', { name: 'Activar perfil de paciente' }),
    ).toHaveCount(0);

    // --- 4. Cobertura financiada y principal -----------------------------------------------
    await page.goto(`/pacientes/${personaId}/coberturas`);
    await page.getByRole('button', { name: 'Agregar una cobertura' }).click();
    const nueva = page.getByRole('region', { name: 'Nueva cobertura' });
    await nueva.getByLabel('Tipo').selectOption('FINANCIADA');
    await nueva.getByLabel('Vigente desde').fill(dia(-30));
    await nueva.getByLabel('Financiador').selectOption({ label: financiador });
    await expect(nueva.getByLabel('Plan').getByRole('option', { name: plan })).toBeAttached();
    await nueva.getByLabel('Plan').selectOption({ label: plan });
    await nueva.getByLabel('Numero de afiliado').fill('E2E-0001');
    await nueva.getByLabel('Marcarla como cobertura principal').check();
    await nueva.getByRole('button', { name: 'Agregar cobertura' }).click();

    await expect(page.getByText(/Principal:/)).toContainText(plan);
    await expect(page.getByRole('cell', { name: 'E2E-0001' })).toBeVisible();

    // --- 5. Orden medica ----------------------------------------------------------------
    await page.goto(`/pacientes/${personaId}/autorizaciones`);
    const ordenes = page.getByRole('region', { name: 'Ordenes medicas' });
    await ordenes.getByRole('button', { name: 'Registrar una orden' }).click();
    await ordenes.getByLabel('Profesional que la firmo').fill('Dra. Sintetica Prueba');
    await ordenes.getByLabel('Matricula').fill('12345');
    await ordenes.getByLabel('Numero', { exact: true }).fill('ORD-1');
    await ordenes.getByLabel('Fecha de emision').fill(dia(-12));
    await ordenes.getByLabel('Vigente desde').fill(dia(-12));
    await ordenes.getByLabel('Vigente hasta').fill(dia(60));
    await ordenes.getByLabel('Sesiones prescriptas').fill('10');
    await ordenes.getByRole('button', { name: 'Registrar orden' }).click();

    const tablaOrdenes = page.getByRole('table', { name: /orden\(es\) del paciente/ });
    await expect(tablaOrdenes.getByRole('cell', { name: 'ORD-1' })).toBeVisible();

    // --- 6. Autorizacion aprobada, vigente, respaldada por la orden ------------------------
    await registrarAutorizacion(page, {
      numero: 'AUT-VIGENTE',
      practica,
      orden: true,
      cantidad: '10',
      desde: dia(-10),
      hasta: dia(5),
    });
    const vigente = filaDeAutorizacion(page, 'AUT-VIGENTE');
    await expect(vigente).toContainText('Aprobada');
    await expect(vigente).toContainText('10 de 10');
    await expect(vigente).toContainText('Habilita a atender');
    await expect(vigente).toContainText('Vence en 5 dias');

    // --- 7. Otra aprobada de la misma practica que se pisa: 409 tipado y la fila senalada --
    const superpuesta = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/personas\/\d+\/autorizaciones$/.test(r.url()),
    );
    await registrarAutorizacion(page, {
      numero: 'AUT-PISA',
      practica,
      cantidad: '5',
      desde: dia(0),
      hasta: dia(20),
    });
    await esperarProblema(
      await superpuesta,
      409,
      'https://akine.app/problems/autorizacion-superpuesta',
    );
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(vigente).toContainText('Es la que se pisa');
    await page
      .getByRole('region', { name: 'Autorizaciones' })
      .getByRole('button', { name: 'Cancelar' })
      .click();

    // --- 8. Una cargada con la vigencia ya terminada nace vencida ---------------------------
    await registrarAutorizacion(page, {
      numero: 'AUT-VENCIDA',
      practica,
      cantidad: '8',
      desde: dia(-60),
      hasta: dia(-20),
    });
    const vencida = filaDeAutorizacion(page, 'AUT-VENCIDA');
    // El estado sigue siendo el que decidio el financiador: vencida no es un estado, es una fecha.
    await expect(vencida).toContainText('Aprobada');
    await expect(vencida).toContainText('No habilita: esta vencida');
    await expect(vencida).not.toContainText(/Vence (hoy|manana|en)/);

    // --- 9. Vencimiento de la vigente: el fin pasa a ayer y deja de habilitar ---------------
    await vigente.getByRole('button', { name: 'Corregir' }).click();
    const correccion = page.getByRole('region', { name: 'Corregir la autorizacion AUT-VIGENTE' });
    await correccion.getByLabel('Vigente hasta').fill(dia(-1));
    await correccion.getByRole('button', { name: 'Guardar la autorizacion' }).click();

    await expect(vigente).toContainText('No habilita: esta vencida');
    await expect(vigente).toContainText('Aprobada');
    await expect(vigente).not.toContainText('Habilita a atender');
    await expect(vigente).not.toContainText(/Vence (hoy|manana|en)/);

    // Y despues de recargar sigue igual: lo calcula el backend, no la pantalla.
    await page.reload();
    await expect(filaDeAutorizacion(page, 'AUT-VIGENTE')).toContainText(
      'No habilita: esta vencida',
    );

    // --- 10. El backend dice lo mismo, y la auditoria registro cada paso ------------------
    const api = await ApiAkine.como(email);
    try {
      const autorizaciones = await api.exigir<
        {
          id: number;
          numero: string;
          estadoAutorizacion: string;
          vencida: boolean;
          habilita: boolean;
        }[]
      >('GET', `/api/v1/personas/${personaId}/autorizaciones`);
      const porNumero = new Map(autorizaciones.map((a) => [a.numero, a]));
      expect(porNumero.has('AUT-PISA'), 'la superpuesta no se guardo').toBe(false);
      for (const numero of ['AUT-VIGENTE', 'AUT-VENCIDA']) {
        expect(porNumero.get(numero), numero).toMatchObject({
          estadoAutorizacion: 'APROBADA',
          vencida: true,
          habilita: false,
        });
      }

      const [{ organizationId }] = await api.exigir<{ organizationId: number }[]>(
        'GET',
        '/api/v1/me/contexts',
      );
      const historial = await api.exigir<{ content: { eventType: string }[] }>(
        'GET',
        `/api/v1/organizations/${organizationId}/audit-events?entityType=Autorizacion&entityId=${porNumero.get('AUT-VIGENTE')!.id}`,
      );
      expect(historial.content.map((e) => e.eventType)).toEqual(
        expect.arrayContaining(['AUTORIZACION_CREATED', 'AUTORIZACION_UPDATED']),
      );
    } finally {
      await api.cerrar();
    }
  });
});

async function registrarAutorizacion(
  page: Page,
  datos: {
    numero: string;
    practica: string;
    orden?: boolean;
    cantidad: string;
    desde: string;
    hasta: string;
  },
): Promise<void> {
  const formulario = page.getByRole('region', { name: 'Autorizaciones' });
  await formulario.getByRole('button', { name: 'Registrar una autorizacion' }).click();
  await formulario.getByLabel('Numero').fill(datos.numero);
  // La unica cobertura activa del paciente.
  await formulario.getByLabel('Cobertura').selectOption({ index: 1 });
  await formulario.getByLabel('Practica').selectOption({ label: datos.practica });
  if (datos.orden) {
    await formulario.getByLabel('Orden que la respalda').selectOption({ index: 1 });
  }
  await formulario.getByLabel('Cantidad pedida').fill(datos.cantidad);
  await formulario.getByLabel('Vigente desde').fill(datos.desde);
  await formulario.getByLabel('Vigente hasta').fill(datos.hasta);
  await formulario.getByLabel('Estado inicial').selectOption('APROBADA');
  await formulario.getByRole('button', { name: 'Registrar autorizacion' }).click();
}
