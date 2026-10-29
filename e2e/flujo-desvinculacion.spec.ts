import { Locator, Page } from '@playwright/test';

import { expect, ingresar, navegar, respuestaDe, test } from './support/agenda-real';
import { abrirAcciones } from './support/filtros';
import { crearPersona, diaDeTrabajo, reservar, verTurno } from './support/sembrado';
import {
  DIAS_CONFIGURACION,
  ofertaDe,
  vincularProfesional,
} from './support/sembrado-configuracion';

/**
 * E2E de la desvinculacion de un profesional con turnos pendientes (RN-M05-004, E-1 + web #17)
 * contra el backend REAL.
 *
 * <p>Antes de revocar, la pantalla consulta la sonda de impacto y dice cuantos turnos quedan a su
 * nombre. La sonda <b>informa y no bloquea</b>: la revocacion pasa y el turno sigue RESERVADO,
 * visible para que alguien lo resuelva. Hasta este spec, el aviso solo se habia visto contra
 * respuestas simuladas.
 *
 * <p>No se toca al profesional compartido del centro: se vincula uno propio, con disponibilidad
 * propia, y la oferta del test la habilita solo a el.
 */

/** La fila del colaborador, recorriendo las paginas del listado (ordenado por id ascendente). */
async function filaDelColaborador(page: Page, nombre: string): Promise<Locator> {
  const region = page.getByRole('region', { name: 'Colaboradores de la organización' });
  const fila = region.getByRole('row').filter({ hasText: nombre });
  await expect(region.getByRole('row').first()).toBeVisible();
  for (let pagina = 0; pagina < 20; pagina++) {
    if ((await fila.count()) > 0) {
      return fila;
    }
    // Pie estandar (UX-14): "Página siguiente" y la pagina actual marcada con aria-current.
    const paginas = page.getByRole('navigation', { name: 'Páginas de colaboradores' });
    const siguiente = paginas.getByRole('button', { name: 'Página siguiente' });
    if ((await siguiente.count()) === 0 || (await siguiente.isDisabled())) {
      break;
    }
    await siguiente.click();
    await expect(
      paginas.getByRole('button', { name: `Página ${pagina + 2}`, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
  }
  await expect(fila, `el colaborador ${nombre} figura en el listado`).toHaveCount(1);
  return fila;
}

test.describe('Desvinculacion de un profesional contra el backend real', () => {
  test('el aviso cuenta el turno pendiente, la revocacion pasa y el turno queda', async ({
    page,
    api,
    centro,
  }) => {
    test.slow();
    const profesional = await vincularProfesional(api, centro);
    for (let diaSemana = 1; diaSemana <= 7; diaSemana++) {
      await api.exigir(
        'POST',
        `/api/v1/consultorios/${centro.consultorioId}/profesionales/${profesional.membershipId}/disponibilidad`,
        { diaSemana, horaDesde: '09:00', horaHasta: '12:00' },
      );
    }
    const oferta = await ofertaDe(api, centro, profesional, { duracionMinutos: 60 });
    const persona = await crearPersona(api);
    const { slots } = await diaDeTrabajo(
      api,
      centro,
      oferta.id,
      DIAS_CONFIGURACION.desvinculacionConTurno,
    );
    const turno = await reservar(
      api,
      { ...centro, profesional },
      oferta.id,
      persona.id,
      slots[0].desde,
    );

    await ingresar(page, centro);
    await navegar(page, '/organizacion/colaboradores');
    const fila = await filaDelColaborador(page, profesional.nombre);

    // --- El panel de revocacion consulta la sonda y muestra el turno pendiente ---
    const impacto = respuestaDe(page, 'GET', /\/memberships\/\d+\/desvinculacion-impacto$/);
    await abrirAcciones(fila);
    await fila.getByRole('button', { name: 'Revocar' }).click();
    const respuesta = await impacto;
    expect(respuesta.status(), await respuesta.text()).toBe(200);
    const cuerpo = (await respuesta.json()) as { count?: number; tipo?: string };
    expect(cuerpo.count).toBe(1);
    expect(cuerpo.tipo).toBe('turnos');
    await expect(page.getByRole('heading', { name: 'Antes de revocar', level: 3 })).toBeVisible();
    await expect(page.getByText(/^Quedan 1 turnos a su nombre/)).toBeVisible();

    // --- Informa, no bloquea: la revocacion pasa ---
    await page.locator('#panel-motivo').fill('Deja de atender en la sede');
    const revocacion = respuestaDe(page, 'POST', /\/memberships\/\d+\/revoke$/);
    await page.getByRole('button', { name: 'Confirmar' }).click();
    expect((await revocacion).status()).toBeLessThan(300);
    await expect(fila.getByText('Revocada', { exact: false })).toBeVisible();
    await expect(fila.getByText('Motivo: Deja de atender en la sede')).toBeVisible();

    // --- Y el turno sigue ahi, para que alguien lo resuelva ---
    expect((await verTurno(api, centro, turno.id)).estado).toBe('RESERVADO');
  });
});
