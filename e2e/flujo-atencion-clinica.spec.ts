import { Page } from '@playwright/test';

import { expect, navegar, respuestaDe, test } from './support/agenda-real';
import {
  ApiAkine,
  comoProfesional,
  crearPersona,
  diaDeTrabajo,
  fijarPrecio,
  reservarElPrimeroLibre,
} from './support/sembrado';
import {
  JUSTIFICACION,
  exigirCon,
  ingresarAlCentro,
  ofertaConPractica,
} from './support/sembrado-pantallas-098';

/**
 * E2E de la atencion clinica completa contra el backend REAL (D-d, D-g):
 * caso → mediciones → tratamientos → cierre → enmienda → versiones.
 *
 * <p>Lo que estos pasos prueban y los unitarios no pueden:
 *
 * <ul>
 *   <li>que el backend acepte el `casoId` solo al crear, y la pantalla lo muestre;</li>
 *   <li>que un valor fuera de rango vuelva como `medicion-fuera-de-rango` con el rango del
 *       catalogo, y que la pantalla lo diga;</li>
 *   <li>que la version que devuelve un tratamiento sea la que el autosave tiene que mandar
 *       despues: si la pantalla la ignorara, "Guardar ahora" comeria un 409 real;</li>
 *   <li>que la enmienda cree la version 2 y que la comparacion muestre lo que cambio.</li>
 * </ul>
 *
 * <p>Ingresa por pantalla como la <b>profesional</b>: la sesion es de quien atiende el turno, y
 * con la administradora todo terminaria en 409 `sesion-ajena`.
 */
test.describe.configure({ mode: 'default' });

/** Bloque de dias propio (ver `DIAS` en `support/sembrado.ts`): lejos de los demas specs. */
const DIA_ATENCION_CLINICA = 147;

test.describe('Atencion clinica contra el backend real', () => {
  test('caso, mediciones, tratamientos, cierre, enmienda y versiones', async ({
    page,
    api,
    centro,
  }) => {
    test.setTimeout(180_000);
    const sufijo = Date.now().toString(36).toUpperCase();

    // --- Sembrado por la API ------------------------------------------------------------
    const { oferta } = await ofertaConPractica(api, centro, 12_000);
    await fijarPrecio(api, centro, oferta, 12_000);
    const definicion = await api.exigir<{ id: number }>('POST', '/api/v1/mediciones/definiciones', {
      codigo: `ROM_E2E_${sufijo}`,
      name: `Flexion de rodilla E2E ${sufijo}`,
      tipo: 'NUMERICO',
      unidad: 'grados',
      minimo: 0,
      maximo: 180,
    });
    expect(definicion.id).toBeGreaterThan(0);

    const persona = await crearPersona(api);
    const { slots } = await diaDeTrabajo(api, centro, oferta.id, DIA_ATENCION_CLINICA);
    const turno = await reservarElPrimeroLibre(api, centro, oferta.id, persona.id, slots);

    const profesional: ApiAkine = await comoProfesional(centro);
    const historia = await exigirCon<{ id: number }>(
      profesional,
      'PUT',
      `/api/v1/historias-clinicas/por-persona/${persona.id}`,
      undefined,
      JUSTIFICACION,
    );
    const caso = await exigirCon<{ id: number; numeroCaso: number }>(
      profesional,
      'POST',
      `/api/v1/historias-clinicas/${historia.id}/casos`,
      { ofertaId: oferta.id, diagnosticoPresuntivo: 'Gonalgia sintetica de los E2E' },
      JUSTIFICACION,
    );

    // --- Pantalla: el caso se elige antes de iniciar -------------------------------------
    await ingresarAlCentro(page, centro.emailProfesional, centro);
    await navegar(page, `/atencion/turnos/${turno.id}`);
    await expect(
      page.getByRole('heading', { name: 'Antes de empezar: caso clínico' }),
    ).toBeVisible();
    // El de la misma oferta viene sugerido.
    await expect(
      page.getByRole('radio', { name: new RegExp(`^Caso ${caso.numeroCaso}`) }),
    ).toBeChecked();

    const inicio = respuestaDe(page, 'POST', /\/sesiones\/turnos\/\d+$/);
    await page.getByRole('button', { name: 'Iniciar atención' }).click();
    const sesion = (await (await inicio).json()) as { id: number; casoId?: number };
    expect(sesion.casoId).toBe(caso.id);
    await expect(page.getByRole('heading', { name: 'Atención en curso' })).toBeVisible();
    await expect(page.getByText(`Caso ${caso.numeroCaso}`, { exact: true })).toBeVisible();

    // --- Mediciones ------------------------------------------------------------------------
    const examen = page.getByRole('region', { name: 'Examen físico' });
    await examen
      .getByLabel('Medida')
      .selectOption({ label: `Flexion de rodilla E2E ${sufijo} (grados)` });
    await examen.getByLabel('Lado').selectOption({ label: 'Derecha' });
    await examen.getByLabel('Valor en grados').fill('200');
    const fueraDeRango = respuestaDe(page, 'PUT', /\/mediciones\/\d+$/);
    await examen.getByRole('button', { name: 'Registrar la medición' }).click();
    expect((await fueraDeRango).status()).toBe(400);
    await expect(examen.getByRole('alert')).toContainText('El catalogo admite de 0 a 180');

    await examen.getByLabel('Valor en grados').fill('95');
    await examen.getByRole('button', { name: 'Registrar la medición' }).click();
    // UX-12: el resultado es un aviso global, en la region de notificaciones.
    const notificaciones = page.getByRole('region', { name: 'Notificaciones' });
    await expect(notificaciones.getByText('Medición registrada')).toBeVisible();
    const filaRom = examen.getByRole('row').filter({ hasText: `Flexion de rodilla E2E ${sufijo}` });
    await expect(filaRom).toContainText('95 grados');
    await expect(filaRom).toContainText('Derecha');

    // --- Tratamientos ------------------------------------------------------------------------
    const tratamiento = page.getByRole('region', { name: 'Tratamiento aplicado' });
    await tratamiento.getByLabel('Zona tratada').fill('rodilla');
    await tratamiento.getByLabel('Lado').selectOption({ label: 'Derecha' });
    await tratamiento.getByLabel('Duración en minutos').fill('15');
    // Los parametros van en la seccion plegada "Parámetros y observación" (refactor UX/UI).
    await tratamiento.getByText('Parámetros y observación').click();
    await tratamiento.getByRole('button', { name: 'Agregar un parámetro' }).click();
    await tratamiento.getByLabel('Nombre del parámetro 1').fill('Intensidad');
    await tratamiento.getByLabel('Valor del parámetro 1').fill('20');
    await tratamiento.getByLabel('Unidad del parámetro 1').fill('mA');
    const registro = respuestaDe(page, 'POST', /\/sesiones\/\d+\/tratamientos$/);
    await tratamiento.getByRole('button', { name: 'Registrar el tratamiento' }).click();
    expect((await registro).ok()).toBe(true);
    await expect(notificaciones.getByText('Tratamiento registrado')).toBeVisible();
    await expect(tratamiento.getByRole('listitem')).toContainText('20 mA');

    // La version avanzo con el tratamiento: el guardado de las notas tiene que mandar la nueva.
    await page
      .getByLabel('Lo que quieras anotar')
      .fill('Paciente refiere mejoria al subir escaleras.');
    const borrador = respuestaDe(page, 'PUT', /\/borrador$/);
    await page.getByRole('button', { name: 'Guardar ahora' }).click();
    expect((await borrador).ok()).toBe(true);

    // --- Cierre --------------------------------------------------------------------------------
    await page.getByRole('radio', { name: 'Vino a la sesión' }).check();
    await page.getByLabel('Nota de cierre').fill('Movilidad y fisioterapia, buena tolerancia.');
    await page.getByRole('button', { name: 'Cerrar la atención' }).click();
    await expect(page.getByRole('heading', { name: 'Atención cerrada' })).toBeVisible();
    // En lectura, el examen y el tratamiento siguen a la vista sin formularios.
    await expect(examen.getByRole('row').filter({ hasText: '95 grados' })).toBeVisible();
    await expect(examen.getByRole('button', { name: 'Registrar la medición' })).toHaveCount(0);
    await expect(tratamiento).toContainText('KIN_SESION');

    // --- Enmienda ----------------------------------------------------------------------------
    await page.getByRole('link', { name: 'Enmendar esta atención' }).click();
    await expect(page).toHaveURL(new RegExp(`/atencion/sesiones/${sesion.id}/enmienda$`));
    await expect(page.getByLabel('Nota de cierre')).toHaveValue(
      'Movilidad y fisioterapia, buena tolerancia.',
    );
    await page.getByRole('button', { name: 'Registrar la enmienda', exact: true }).click();
    // UX-12: la validacion va en el campo, no al pie del formulario.
    const motivoDeEnmienda = page.getByLabel('Motivo de la enmienda');
    await expect(motivoDeEnmienda).toHaveAttribute('aria-invalid', 'true');
    await expect(motivoDeEnmienda).toHaveAccessibleDescription(/Falta el motivo/);

    await motivoDeEnmienda.fill('La intensidad y el ROM se cargaron mal');
    await page.getByLabel('Intensidad (mA)').fill('25');
    await page.getByLabel('Valor en grados').fill('100');
    const enmienda = respuestaDe(page, 'POST', /\/enmiendas$/);
    await page.getByRole('button', { name: 'Registrar la enmienda', exact: true }).click();
    expect((await enmienda).ok()).toBe(true);

    // --- Versiones ---------------------------------------------------------------------------
    await expect(page).toHaveURL(new RegExp(`/atencion/sesiones/${sesion.id}/versiones$`));
    await expect(page.getByRole('heading', { name: 'Qué cambió' })).toBeVisible();
    await expect(page.getByText('La intensidad y el ROM se cargaron mal').first()).toBeVisible();
    const comparacion = page.getByRole('region', { name: 'Comparación de versiones' });
    const filaTratamiento = comparacion.getByRole('row').filter({ hasText: 'Tratamiento:' });
    await expect(filaTratamiento).toContainText('Intensidad: 20 mA');
    await expect(filaTratamiento).toContainText('Intensidad: 25 mA');
    await expect(filaTratamiento.getByRole('cell').last()).toHaveText('Cambió');
    const filaMedicion = comparacion.getByRole('row').filter({ hasText: 'Medición:' });
    await expect(filaMedicion).toContainText('95 grados');
    await expect(filaMedicion).toContainText('100 grados');
    await expect(
      comparacion.getByRole('row').filter({ hasText: 'Nota de cierre' }).getByRole('cell').last(),
    ).toHaveText('Igual');

    await verificarQueNadaClinicoVaALaUrl(page);
  });
});

/** Ningun dato clinico viaja en la URL: la ruta lleva solo ids. */
async function verificarQueNadaClinicoVaALaUrl(page: Page): Promise<void> {
  const url = decodeURIComponent(page.url());
  for (const clinico of ['rodilla', 'Intensidad', 'kinesiologia', 'grados']) {
    expect(url).not.toContain(clinico);
  }
}
