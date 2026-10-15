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
 * E2E de los pedidos de la atencion clinica que resolvio `appKine-api` #127 (contrato 0.102.0),
 * contra el backend REAL:
 *
 * <ul>
 *   <li><b>cambiar el caso con la atencion abierta</b> (`PUT .../sesiones/{id}/caso`): se inicia sin
 *       caso, se asocia uno desde la tarjeta de la atencion y la respuesta trae la version nueva;</li>
 *   <li><b>la baja de un tratamiento devuelve la version nueva</b> (200 con cuerpo, antes 204): si
 *       la pantalla no la tomara, el "Guardar ahora" que sigue comeria un 409 real;</li>
 *   <li><b>`registradaPorNombre`</b>: el historial de versiones dice quien cerro.</li>
 * </ul>
 *
 * <p>El 400 del borrador con JSON invalido no se puede provocar desde la pantalla —las notas
 * siempre viajan como `{"notas": ...}` bien formado— y queda en los unitarios.
 *
 * <p>Datos propios: oferta, persona, historia, dos casos y su propio bloque de dias. Ingresa como
 * la <b>profesional</b>, que es la duena de la sesion.
 */
test.describe.configure({ mode: 'default' });

/** Bloque de dias propio (ver `DIAS` en `support/sembrado.ts`): lejos de los demas specs. */
const DIA_PEDIDOS_DE_LA_ATENCION = 213;

test.describe('Pedidos de la atencion clinica contra el backend real', () => {
  test('caso cambiado en curso, baja de tratamiento sin 409 y autor de la version', async ({
    page,
    api,
    centro,
  }) => {
    test.setTimeout(180_000);

    // --- Sembrado por la API ------------------------------------------------------------
    const { oferta } = await ofertaConPractica(api, centro, 9_000);
    await fijarPrecio(api, centro, oferta, 9_000);
    const persona = await crearPersona(api);
    const { slots } = await diaDeTrabajo(api, centro, oferta.id, DIA_PEDIDOS_DE_LA_ATENCION);
    const turno = await reservarElPrimeroLibre(api, centro, oferta.id, persona.id, slots);

    const profesional: ApiAkine = await comoProfesional(centro);
    const historia = await exigirCon<{ id: number }>(
      profesional,
      'PUT',
      `/api/v1/historias-clinicas/por-persona/${persona.id}`,
      undefined,
      JUSTIFICACION,
    );
    const casos: { id: number; numeroCaso: number }[] = [];
    for (const diagnostico of ['Lumbalgia sintetica de los E2E', 'Cervicalgia sintetica E2E']) {
      casos.push(
        await exigirCon<{ id: number; numeroCaso: number }>(
          profesional,
          'POST',
          `/api/v1/historias-clinicas/${historia.id}/casos`,
          // El segundo comparte oferta con el primero: se declara que es otro problema.
          {
            ofertaId: oferta.id,
            diagnosticoPresuntivo: diagnostico,
            confirmaPosibleDuplicado: casos.length > 0,
          },
          JUSTIFICACION,
        ),
      );
    }
    const [primero, segundo] = casos;

    // --- Se inicia SIN caso -------------------------------------------------------------
    await ingresarAlCentro(page, centro.emailProfesional, centro);
    await navegar(page, `/atencion/turnos/${turno.id}`);
    await expect(
      page.getByRole('heading', { name: 'Antes de empezar: caso clinico' }),
    ).toBeVisible();
    await page.getByRole('radio', { name: 'Sin caso' }).check();
    const inicio = respuestaDe(page, 'POST', /\/sesiones\/turnos\/\d+$/);
    await page.getByRole('button', { name: 'Iniciar la atencion' }).click();
    const sesion = (await (await inicio).json()) as { id: number; casoId?: number };
    expect(sesion.casoId ?? null).toBeNull();
    await expect(page.getByRole('heading', { name: 'Atencion en curso' })).toBeVisible();

    // --- Se asocia un caso con la atencion abierta, y despues se cambia ------------------
    const selector = page.getByLabel('Caso clinico de esta atencion');
    await selector.selectOption(String(segundo.id));
    const asociar = respuestaDe(page, 'PUT', /\/sesiones\/\d+\/caso$/);
    await page.getByRole('button', { name: 'Guardar el caso' }).click();
    const asociada = await asociar;
    expect(asociada.status()).toBe(200);
    expect(((await asociada.json()) as { casoId?: number }).casoId).toBe(segundo.id);
    await expect(page.getByRole('status').filter({ hasText: 'quedo asociada' })).toContainText(
      `Caso ${segundo.numeroCaso}`,
    );

    await selector.selectOption(String(primero.id));
    const cambiar = respuestaDe(page, 'PUT', /\/sesiones\/\d+\/caso$/);
    await page.getByRole('button', { name: 'Guardar el caso' }).click();
    expect((await cambiar).status()).toBe(200);
    await expect(page.getByRole('status').filter({ hasText: 'quedo asociada' })).toContainText(
      `Caso ${primero.numeroCaso}`,
    );

    // --- Tratamiento: alta y baja, y el guardado que sigue no come un 409 ----------------
    const tratamiento = page.getByRole('region', { name: 'Tratamiento aplicado' });
    await tratamiento.getByLabel('Zona tratada').fill('lumbar');
    const registro = respuestaDe(page, 'POST', /\/sesiones\/\d+\/tratamientos$/);
    await tratamiento.getByRole('button', { name: 'Registrar el tratamiento' }).click();
    expect((await registro).ok()).toBe(true);
    await expect(tratamiento.getByRole('status')).toContainText('Tratamiento registrado');

    await tratamiento.getByRole('button', { name: /^Dar de baja/ }).click();
    await tratamiento.getByLabel(/^Por que se da de baja/).fill('Se cargo en la sesion equivocada');
    const baja = respuestaDe(page, 'DELETE', /\/tratamientos\/\d+$/);
    await tratamiento.getByRole('button', { name: 'Confirmar la baja' }).click();
    const respuestaBaja = await baja;
    expect(respuestaBaja.status()).toBe(200);
    const dadoDeBaja = (await respuestaBaja.json()) as {
      vigente?: boolean;
      sesionVersion?: number;
    };
    expect(dadoDeBaja.vigente).toBe(false);
    expect(dadoDeBaja.sesionVersion).toBeGreaterThan(0);
    await expect(tratamiento.getByRole('status')).toContainText('dado de baja');

    await page.getByLabel('Lo que quieras anotar').fill('Sin tratamiento estructurado hoy.');
    const borrador = respuestaDe(page, 'PUT', /\/borrador$/);
    await page.getByRole('button', { name: 'Guardar ahora' }).click();
    const guardado = await borrador;
    expect(guardado.status()).toBe(200);
    // La version que mando el borrador es la que anuncio la baja: sin releer la sesion.
    expect((guardado.request().postDataJSON() as { version: number }).version).toBe(
      dadoDeBaja.sesionVersion,
    );

    // --- Cierre y autor de la version 1 --------------------------------------------------
    await page.getByRole('radio', { name: 'Vino a la sesion' }).check();
    await page.getByLabel('Nota de cierre').fill('Educacion postural, buena tolerancia.');
    await page.getByRole('button', { name: 'Cerrar la atencion' }).click();
    await expect(page.getByRole('heading', { name: 'Atencion cerrada' })).toBeVisible();
    await expect(page.getByLabel('Caso clinico de esta atencion')).toHaveCount(0);

    const versiones = respuestaDe(page, 'GET', /\/sesiones\/\d+\/versiones$/);
    await page.getByRole('link', { name: 'Ver las versiones' }).click();
    const lista = (await (await versiones).json()) as { registradaPorNombre?: string }[];
    const autor = lista[0]?.registradaPorNombre;
    expect(autor, 'el backend tiene que resolver el nombre de quien cerro').toBeTruthy();
    await expect(page.getByText(`por ${autor}`).first()).toBeVisible();
  });
});
