import { randomUUID } from 'node:crypto';

import { nonce } from './support/akine';
import { expect, navegar, respuestaDe, test } from './support/agenda-real';
import {
  ApiAkine,
  comoProfesional,
  crearOferta,
  crearPersona,
  fechaLocal,
} from './support/sembrado';
import { instanteEnZona } from './support/sembrado-asistencia';
import { JUSTIFICACION, exigirCon, ingresarAlCentro } from './support/sembrado-pantallas-098';

/**
 * E2E de la atencion clinica grupal (AKINE-08.05) contra el backend REAL.
 *
 * <p>Clase de una oferta grupal que genera registro clinico, con una participante presente que
 * tiene un Caso activo → panel de atencion clinica de la clase → "Derivar a un caso" (AKINE-08.04:
 * elegibilidad, casos activos por los datos administrativos, derivacion) → "Iniciar atencion" → la
 * Sesion abre en la pantalla de atencion de siempre, marcada como de la clase y sin selector de
 * caso → de vuelta en el panel, la atencion figura en curso y la derivacion explica que ya no se
 * revierte.
 *
 * <p>Lo que estos pasos prueban y los unitarios no pueden: que la elegibilidad y los datos
 * administrativos le alcancen a la profesional para elegir el Caso, que el backend acepte la
 * derivacion que arma la pantalla, que abra la Sesion desde ella con el Caso de la derivacion, que
 * `verSesion` devuelva `claseId`/`derivacionId` para que la pantalla la reconozca como grupal, y
 * que el panel la liste despues.
 *
 * <p>Ingresa por pantalla como la <b>profesional</b>: `sesion:register` es suyo y la Sesion es de
 * quien la abre.
 */
test.describe.configure({ mode: 'default' });

/** Bloque de dias propio (ver `DIAS` en `support/sembrado.ts`): lejos de los demas specs. */
const DIA_ATENCION_GRUPAL = 153;

test.describe('Atencion clinica grupal contra el backend real', () => {
  test('panel de la clase, iniciar la atencion de una participante y abrir su Sesion', async ({
    page,
    api,
    centro,
  }) => {
    test.setTimeout(180_000);
    const base = `/api/v1/consultorios/${centro.consultorioId}`;

    // --- Sembrado por la API ------------------------------------------------------------
    const oferta = await crearOferta(api, centro, {
      nombre: `Rehabilitacion grupal E2E ${nonce()}`,
      habilitarProfesional: false,
      extra: {
        modalidad: 'GRUPAL',
        capacidad: 8,
        requiereProfesional: false,
        generaRegistroClinico: true,
      },
    });
    const fecha = fechaLocal(centro.timezone, DIA_ATENCION_GRUPAL);
    const minuto = String(Math.floor(Math.random() * 6) * 10).padStart(2, '0');
    const titulo = `Rehabilitacion de rodilla ${nonce()}`;
    const clase = await api.exigir<{ id: number }>('POST', `${base}/clases/ofertas/${oferta.id}`, {
      titulo,
      capacidad: 6,
      inicio: instanteEnZona(fecha, `15:${minuto}`, centro.timezone),
      fin: instanteEnZona(fecha, `16:${minuto}`, centro.timezone),
      idempotencyKey: randomUUID(),
    });
    const persona = await crearPersona(api, { nombre: 'Marta' });
    const { inscripcion } = await api.exigir<{ inscripcion: { id: number } }>(
      'POST',
      `${base}/clases/${clase.id}/inscripciones`,
      { personaId: persona.id, aceptaListaEspera: false, idempotencyKey: randomUUID() },
    );
    await api.exigir('POST', `${base}/clases/${clase.id}/inicio`);
    await api.exigir('POST', `${base}/clases/${clase.id}/asistencias/lote`, {
      items: [{ inscripcionId: inscripcion.id, resultado: 'PRESENTE' }],
    });

    // La profesional abre la historia y el Caso. Derivar a la participante es por pantalla.
    const profesional: ApiAkine = await comoProfesional(centro);
    const historia = await exigirCon<{ id: number }>(
      profesional,
      'PUT',
      `/api/v1/historias-clinicas/por-persona/${persona.id}`,
      undefined,
      JUSTIFICACION,
    );
    const caso = await exigirCon<{ id: number }>(
      profesional,
      'POST',
      `/api/v1/historias-clinicas/${historia.id}/casos`,
      { ofertaId: oferta.id, diagnosticoPresuntivo: 'Gonalgia sintetica de los E2E' },
      JUSTIFICACION,
    );

    // --- Pantalla: el panel de la clase ---------------------------------------------------
    await ingresarAlCentro(page, centro.emailProfesional, centro);
    const panel = respuestaDe(page, 'GET', /\/clases\/\d+\/atencion-clinica$/);
    await navegar(page, `/atencion/clases/${clase.id}`);
    expect((await panel).status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(titulo);

    const fila = page.getByRole('row').filter({ hasText: persona.apellido });
    await expect(fila).toContainText('Presente');
    await expect(fila).toContainText('Sin atención');

    // --- Derivar por pantalla: elegibilidad, el Caso activo y la derivacion ------------------
    const elegibilidad = respuestaDe(page, 'GET', /\/inscripciones\/\d+\/elegibilidad-clinica$/);
    await fila.getByRole('button', { name: /Derivar a un caso/ }).click();
    expect((await elegibilidad).status()).toBe(200);
    const tarjeta = page.getByRole('region', { name: /^Derivar a .* a un caso clínico$/ });
    await expect(tarjeta).toContainText('Sí, con perfil de paciente');
    await expect(tarjeta).toContainText('Con 1 caso activo');
    const destino = tarjeta.getByRole('radio', { name: /Caso clinico 1/ });
    await expect(destino).toBeChecked();
    await tarjeta
      .getByRole('textbox', { name: /Motivo de la derivación/ })
      .fill('Derivacion sintetica de los E2E');
    const pedidoDerivar = respuestaDe(page, 'POST', /\/inscripciones\/\d+\/derivaciones$/);
    await tarjeta.getByRole('button', { name: 'Derivar al caso' }).click();
    let derivada = await pedidoDerivar;
    if (derivada.status() === 403) {
      await page
        .getByRole('textbox', { name: 'Motivo del acceso' })
        .fill(JUSTIFICACION['X-Justificacion-Acceso']);
      const reintento = respuestaDe(page, 'POST', /\/inscripciones\/\d+\/derivaciones$/);
      await page.getByRole('button', { name: 'Declarar y seguir' }).click();
      derivada = await reintento;
    }
    expect(derivada.status()).toBe(201);
    const derivacion = (await derivada.json()) as { id: number; casoClinicoId: number };
    expect(derivacion.casoClinicoId).toBe(caso.id);
    await expect(page.getByText(/quedo derivada al caso clinico 1/)).toBeVisible();
    await expect(fila).toContainText('Derivada al caso clinico 1');

    // --- Iniciar atención: sin relacion asistencial el backend puede pedir motivo ---------
    const inicio = respuestaDe(page, 'POST', /\/inscripciones\/\d+\/atencion-clinica$/);
    await fila.getByRole('button', { name: /Iniciar atención/ }).click();
    let respuesta = await inicio;
    if (respuesta.status() === 403) {
      await page
        .getByRole('textbox', { name: 'Motivo del acceso' })
        .fill(JUSTIFICACION['X-Justificacion-Acceso']);
      const reintento = respuestaDe(page, 'POST', /\/inscripciones\/\d+\/atencion-clinica$/);
      await page.getByRole('button', { name: 'Declarar y seguir' }).click();
      respuesta = await reintento;
    }
    expect(respuesta.status()).toBe(201);
    const atencion = (await respuesta.json()) as {
      sesionId: number;
      casoId: number;
      derivacionId: number;
    };
    expect(atencion.casoId).toBe(caso.id);
    expect(atencion.derivacionId).toBe(derivacion.id);

    // --- La Sesion abre en la pantalla de atencion, como de la clase -----------------------
    await expect(page).toHaveURL(new RegExp(`/atencion/sesiones/${atencion.sesionId}$`));
    await expect(page.getByRole('heading', { name: 'Atención en curso' })).toBeVisible();
    // De que clase viene, por su titulo (Sesion.claseTitulo, 0.118.0), no por su id.
    await expect(
      page.locator('dd').filter({ hasText: 'Participante de la clase grupal' }),
    ).toContainText(titulo);
    await expect(page.getByLabel('Caso clínico de esta atención')).toHaveCount(0);

    // --- De vuelta en el panel: la atencion en curso, y la derivacion ya no se revierte ------
    await page.getByRole('link', { name: 'Volver a la atención clínica de la clase' }).click();
    const filaDespues = page.getByRole('row').filter({ hasText: persona.apellido });
    await expect(filaDespues).toContainText('Atención en curso');
    await expect(filaDespues.getByRole('button', { name: /Iniciar atención/ })).toHaveCount(0);

    // Leer las derivaciones es lectura clinica: la pantalla nueva no recuerda el motivo declarado.
    const lectura = respuestaDe(page, 'GET', /\/inscripciones\/\d+\/derivaciones$/);
    await filaDespues.getByRole('button', { name: /Derivaciones/ }).click();
    if ((await lectura).status() === 403) {
      await page
        .getByRole('textbox', { name: 'Motivo del acceso' })
        .fill(JUSTIFICACION['X-Justificacion-Acceso']);
      await page.getByRole('button', { name: 'Declarar y seguir' }).click();
    }
    const derivaciones = page.getByRole('region', { name: /Derivaciones de/ });
    await expect(derivaciones).toContainText('la derivación no se puede revertir');

    // Y el backend lo confirma: revertir es 409 derivacion-con-sesion.
    const reversion = await profesional.pedir(
      'POST',
      `${base}/clases/${clase.id}/inscripciones/${inscripcion.id}/derivaciones/${derivacion.id}/reversion`,
      { motivo: 'Intento del E2E' },
      JUSTIFICACION,
    );
    expect(reversion.status()).toBe(409);
    expect(((await reversion.json()) as { type: string }).type).toContain('derivacion-con-sesion');
  });
});
