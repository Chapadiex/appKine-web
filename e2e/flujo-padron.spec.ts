import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { nonce } from './support/akine';

/**
 * E2E del padron de personas (M07, AKINE-03.01) contra el backend REAL: alta por pantalla,
 * activacion del perfil de paciente SIN motivo, edicion y baja de la ficha desde el 360.
 *
 * <p>El caso que importa es el del 30/08/2026: el motivo de "Activar perfil" es opcional en el
 * contrato y la pantalla lo rotula "(opcional)", pero `confirmacion-con-motivo` lo exigia siempre y
 * el boton no enviaba nada —sin peticion, sin error, sin sintoma—. El spec unitario miraba el texto
 * del panel y nunca enviaba. Aca se afirma la PETICION que sale y lo que el servidor guardo.
 */
test.describe('Padron de personas contra el backend real', () => {
  test.beforeEach(async ({ page, centro }) => {
    await ingresar(page, centro);
  });

  test('alta, perfil de paciente sin motivo, edicion y baja de la ficha', async ({ page, api }) => {
    const apellido = `Padron${nonce()}`;
    const fila = page.getByRole('row').filter({ hasText: apellido });

    await navegar(page, '/pacientes');
    await expect(page.getByRole('heading', { name: 'Padrón de personas', level: 1 })).toBeVisible();

    // --- Alta por pantalla ---
    await page.getByRole('button', { name: 'Dar de alta una persona' }).click();
    await page.getByLabel('Apellido', { exact: true }).fill(apellido);
    await page.getByLabel('Nombre', { exact: true }).fill('Marta');
    await page.getByLabel('Teléfono', { exact: true }).fill('3515550101');
    const alta = respuestaDe(page, 'POST', /\/personas$/);
    await page.getByRole('button', { name: 'Dar de alta', exact: true }).click();
    const creada = await alta;
    expect(creada.status(), await creada.text()).toBe(201);
    const { id: personaId } = (await creada.json()) as { id: number };
    await expect(page.getByText(`${apellido}, Marta quedo registrada`)).toBeVisible();

    await page.getByLabel(/Documento, apellido, nombre/).fill(apellido);
    await expect(fila).toBeVisible();
    await expect(fila.getByText('Activa', { exact: true })).toBeVisible();

    // --- Perfil de paciente con el motivo VACIO: el boton tiene que enviar ---
    await fila.getByRole('button', { name: 'Activar perfil de paciente' }).click();
    await expect(page.getByLabel('Motivo (opcional)')).toHaveValue('');
    const activacion = respuestaDe(page, 'POST', /\/personas\/\d+\/perfil-paciente$/);
    await page.getByRole('button', { name: 'Activar perfil', exact: true }).click();
    expect((await activacion).ok(), 'el boton envio la activacion con el motivo vacio').toBe(true);
    await expect(page.getByText(`${apellido}, Marta ya es paciente`)).toBeVisible();
    await expect(fila.getByRole('button', { name: 'Activar perfil de paciente' })).toHaveCount(0);

    const conPerfil = await api.exigir<{ esPaciente: boolean }>(
      'GET',
      `/api/v1/personas/${personaId}`,
    );
    expect(conPerfil.esPaciente).toBe(true);

    // --- Edicion ---
    await fila.getByRole('button', { name: 'Editar' }).click();
    await page.locator(`#edicion-telefono-${personaId}`).fill('3515550199');
    const edicion = respuestaDe(page, 'PATCH', new RegExp(`/personas/${personaId}$`));
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    expect((await edicion).status()).toBe(200);
    await expect(page.getByText(`Se guardaron los cambios de ${apellido}, Marta.`)).toBeVisible();
    await expect(fila.getByText('3515550199')).toBeVisible();

    // --- Baja de la ficha desde el 360 ---
    await fila.getByRole('link', { name: 'Ver ficha' }).click();
    await expect(page).toHaveURL(new RegExp(`/pacientes/${personaId}$`));
    await page.getByRole('button', { name: 'Dar de baja la ficha' }).click();

    // Aca el motivo SI es obligatorio (RF-M07-005): vacio no sale nada a la red.
    let bajasEnviadas = 0;
    page.on('request', (r) => {
      if (r.method() === 'DELETE' && new URL(r.url()).pathname.endsWith(`/personas/${personaId}`)) {
        bajasEnviadas++;
      }
    });
    await page.getByRole('button', { name: 'Confirmar la baja de la ficha' }).click();
    await expect(page.locator('#baja-persona')).toHaveAttribute('aria-invalid', 'true');
    expect(bajasEnviadas, 'con el motivo vacio la baja no se envia').toBe(0);

    await page.getByLabel('Motivo', { exact: true }).fill('Ficha duplicada en el E2E');
    const baja = respuestaDe(page, 'DELETE', new RegExp(`/personas/${personaId}$`));
    await page.getByRole('button', { name: 'Confirmar la baja de la ficha' }).click();
    expect((await baja).status()).toBe(200);
    await expect(page.getByText(`${apellido}, Marta quedo dada de baja del padron`)).toBeVisible();

    const dadaDeBaja = await api.exigir<{ estado: string; esPaciente: boolean }>(
      'GET',
      `/api/v1/personas/${personaId}`,
    );
    expect(dadaDeBaja.estado).toBe('INACTIVO');
    // La baja de la ficha arrastra la del perfil en la misma transaccion.
    expect(dadaDeBaja.esPaciente).toBe(false);
  });
});
