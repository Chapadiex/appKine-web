import { nonce } from './support/akine';
import { expect, navegar, test } from './support/agenda-real';
import { ApiAkine, comoProfesional, crearOferta, crearPersona } from './support/sembrado';
import {
  JUSTIFICACION,
  colaboradoraActiva,
  exigirCon,
  ingresarAlCentro,
} from './support/sembrado-pantallas-098';

/**
 * E2E de los datos administrativos de la historia clinica en el Paciente 360 (web #74, api #109)
 * contra el backend REAL, con una cuenta ADMINISTRATIVO.
 *
 * <p>La matriz §32 le da al ADMINISTRATIVO "Limitado" en Ver Historia Clinica: solo metadatos. La
 * profesional abre la historia de una persona, le carga un antecedente y un caso con diagnostico y
 * objetivo —contenido clinico con textos unicos— y la administrativa mira el 360: ve que tiene
 * historia, el caso con su oferta y su equipo, y NINGUNO de esos textos, ni en la pantalla ni en la
 * respuesta. Por la API, la historia clinica en si le responde 403. Una segunda persona, paciente sin
 * historia, muestra el aviso.
 */

test.describe('Historia clinica administrativa en el Paciente 360 contra el backend real', () => {
  let profesional: ApiAkine;

  test.beforeAll(async ({ centro }) => {
    profesional = await comoProfesional(centro);
  });

  test.afterAll(async () => {
    await profesional.cerrar();
  });

  test('la administrativa ve casos y equipo, nunca contenido clinico; sin historia, el aviso', async ({
    page,
    api,
    centro,
  }) => {
    test.slow();
    const sufijo = nonce();
    const clinico = {
      antecedente: `Alergia sintetica a la penicilina ${sufijo}`,
      diagnostico: `Esguince sintetico de tobillo ${sufijo}`,
      objetivo: `Marcha sin dolor sintetica ${sufijo}`,
    };

    // --- La profesional abre historia, antecedente y caso -----------------------------------
    const oferta = await crearOferta(api, centro);
    const conHistoria = await crearPersona(api);
    const sinHistoria = await crearPersona(api);
    const historia = await exigirCon<{ id: number }>(
      profesional,
      'PUT',
      `/api/v1/historias-clinicas/por-persona/${conHistoria.id}`,
      undefined,
      JUSTIFICACION,
    );
    await exigirCon(
      profesional,
      'POST',
      `/api/v1/historias-clinicas/por-persona/${conHistoria.id}/antecedentes`,
      { tipo: 'ALERGIA', descripcion: clinico.antecedente },
      JUSTIFICACION,
    );
    const caso = await exigirCon<{ numeroCaso: number }>(
      profesional,
      'POST',
      `/api/v1/historias-clinicas/${historia.id}/casos`,
      {
        ofertaId: oferta.id,
        diagnosticoPresuntivo: clinico.diagnostico,
        objetivoTerapeutico: clinico.objetivo,
        equipo: [{ profesionalMembershipId: centro.profesional.membershipId, rol: 'RESPONSABLE' }],
      },
      JUSTIFICACION,
    );

    // --- La administrativa: por la API, metadatos si, historia clinica no -------------------
    const { email } = await colaboradoraActiva(api, centro, 'ADMINISTRATIVO');
    const administrativa = await ApiAkine.como(email, { organizationId: centro.organizationId });
    try {
      const historiaClinica = await administrativa.pedir(
        'GET',
        `/api/v1/historias-clinicas/por-persona/${conHistoria.id}`,
        undefined,
        JUSTIFICACION,
      );
      expect(historiaClinica.status(), await historiaClinica.text()).toBe(403);

      const datos = await administrativa.pedir(
        'GET',
        `/api/v1/historias-clinicas/por-persona/${conHistoria.id}/datos-administrativos`,
      );
      expect(datos.status()).toBe(200);
      const crudo = await datos.text();
      for (const texto of Object.values(clinico)) {
        expect(crudo, 'la respuesta no trae contenido clinico').not.toContain(texto);
      }
    } finally {
      await administrativa.cerrar();
    }

    // --- La pantalla: el 360 con historia ----------------------------------------------------
    await ingresarAlCentro(page, email, centro);
    await navegar(page, `/pacientes/${conHistoria.id}`);
    const seccion = page.getByRole('region', {
      name: 'Historia clínica: datos administrativos',
    });
    await expect(seccion.getByText('Historia abierta el')).toBeVisible();
    const fila = seccion
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: `N.º ${caso.numeroCaso}`, exact: true }) });
    await expect(fila).toHaveCount(1);
    await expect(fila).toContainText('Activo');
    await expect(fila).toContainText(oferta.nombre);
    await expect(fila).toContainText(`${centro.profesional.nombre} (responsable)`);

    const pantalla = await page.locator('main').innerText();
    for (const texto of Object.values(clinico)) {
      expect(pantalla, 'el 360 no muestra contenido clinico').not.toContain(texto);
    }

    // --- Paciente sin historia: el aviso ------------------------------------------------------
    await navegar(page, `/pacientes/${sinHistoria.id}`);
    await expect(
      page
        .getByRole('region', { name: 'Historia clínica: datos administrativos' })
        .getByText('Esta persona todavía no tiene historia clínica'),
    ).toBeVisible();
  });
});
