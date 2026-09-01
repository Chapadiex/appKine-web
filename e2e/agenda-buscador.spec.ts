import { expect, test } from '@playwright/test';

import {
  ApiDeTurnos,
  NOMBRE_OFERTA,
  agendaDe,
  anchoEnDias,
  diaConSlots,
  diaVacio,
  instalarApiDeTurnos,
  masDias,
  ok,
  problema,
} from './support/agenda-simulada';

/**
 * E2E del buscador de agenda (M12, AKINE-05.01).
 *
 * <p>Cubre las tres afirmaciones que la etapa hace sobre la grilla y que ningun test unitario
 * puede sostener solo, porque dependen de que el router, los guards, los signals y el cliente
 * generado se comporten juntos en un navegador de verdad:
 *
 * <ol>
 *   <li>Ningun dia de la ventana se omite, y cada dia vacio muestra <b>su</b> motivo.</li>
 *   <li>La ventana de mas de 62 dias se recorta sola y se reintenta, en vez de fallar.</li>
 *   <li>El slot completo se dibuja marcado, no se esconde.</li>
 * </ol>
 *
 * <p>El alcance y los limites del harness estan en `support/agenda-simulada.ts`.
 */

/** Deja el buscador con una oferta elegida y la grilla dibujada. */
async function elegirLaOferta(page: import('@playwright/test').Page): Promise<void> {
  await page.getByLabel('Oferta', { exact: true }).selectOption({ label: NOMBRE_OFERTA });
  await expect(page.getByRole('heading', { name: NOMBRE_OFERTA, level: 2 })).toBeVisible();
}

test.describe('Buscador de agenda', () => {
  let api: ApiDeTurnos;

  test.beforeEach(async ({ page }) => {
    api = await instalarApiDeTurnos(page);
  });

  /**
   * Escenario 2. Es la mitad del criterio de aceptacion de AKINE-05.01: el backend nunca omite
   * un dia de la ventana y manda `motivoSinSlots` con uno de nueve valores.
   *
   * <p>Se afirman las dos cosas por separado, porque son dos fallas distintas: que <b>esten los
   * cinco dias</b> —un salto de fechas es indistinguible de un error del sistema— y que cada uno
   * diga <b>algo distinto</b> —un "no hay turnos" generico no dice si hay que cargar un horario,
   * habilitar un profesional o simplemente probar otro dia—.
   */
  test('ningun dia de la ventana se omite y cada dia vacio muestra su motivo', async ({ page }) => {
    api.agenda = (url) => {
      const desde = url.searchParams.get('desde') ?? '';
      return ok(
        agendaDe([
          diaConSlots(desde),
          diaVacio(masDias(desde, 1), 'FERIADO'),
          diaVacio(masDias(desde, 2), 'SIN_HORARIO'),
          diaVacio(masDias(desde, 3), 'COMPLETO'),
          diaVacio(masDias(desde, 4), 'OFERTA_NO_VIGENTE'),
        ]),
      );
    };

    await page.goto('/agenda');
    await elegirLaOferta(page);

    // Los cinco dias estan dibujados: ninguno se salteo por venir vacio.
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(5);

    // Y los cuatro motivos dicen cosas distintas, que es la razon por la que el backend los
    // distingue en vez de mandar un unico "sin turnos".
    await expect(page.getByText('Feriado: la sede no atiende este dia.')).toBeVisible();
    await expect(
      page.getByText('Ningun profesional habilitado tiene horario cargado este dia.'),
    ).toBeVisible();
    await expect(page.getByText('Todos los turnos de este dia ya estan reservados.')).toBeVisible();
    await expect(page.getByText('La oferta no esta vigente este dia.')).toBeVisible();

    // El resumen de ventana vacia NO aparece: hay un dia con turnos.
    await expect(page.getByText('Ningun dia de este rango tiene turnos disponibles')).toHaveCount(
      0,
    );
  });

  /**
   * Escenario 5. El 400 `ventana-demasiado-amplia` trae `maxDays`, y con ese numero la pantalla
   * recorta y <b>vuelve a pedir</b>. Es la diferencia entre una pantalla que responde y un cartel.
   *
   * <p>Se afirman las tres consecuencias: que la segunda consulta salio con la ventana recortada,
   * que el campo de la pantalla quedo en el valor recortado —si no, el proximo cambio vuelve a
   * fallar— y que <b>hay grilla y no hay error</b>.
   */
  test('la ventana de mas de 62 dias se recorta sola y se reintenta, sin mostrar un error', async ({
    page,
  }) => {
    const MAXIMO = 62;
    api.agenda = (url) => {
      const desde = url.searchParams.get('desde') ?? '';
      const hasta = url.searchParams.get('hasta') ?? '';
      if (anchoEnDias(desde, hasta) > MAXIMO) {
        return problema(400, 'ventana-demasiado-amplia', 'La ventana pedida supera el maximo.', {
          maxDays: MAXIMO,
        });
      }
      return ok(agendaDe([diaConSlots(desde)]));
    };

    await page.goto('/agenda');
    await elegirLaOferta(page);

    const desde = await page.getByLabel('Desde').inputValue();
    api.ventanasPedidas.length = 0;

    await page.getByLabel('Hasta (sin incluir)').fill(masDias(desde, 120));

    // El aviso dice que se recorto, que es distinto de fallar.
    await expect(page.getByText('Lo recortamos y volvimos a pedirla.')).toBeVisible();

    // El campo quedo en el valor recortado: si no, el proximo cambio del usuario vuelve a fallar.
    await expect(page.getByLabel('Hasta (sin incluir)')).toHaveValue(masDias(desde, MAXIMO));

    // Y la grilla esta: la consulta se hizo igual.
    await expect(page.getByRole('heading', { name: NOMBRE_OFERTA, level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(1);

    // La prueba de que reintento solo: dos consultas, la segunda ya recortada.
    expect(api.ventanasPedidas).toEqual([
      { desde, hasta: masDias(desde, 120) },
      { desde, hasta: masDias(desde, MAXIMO) },
    ]);

    // Y el aviso no sobrevive a la consulta siguiente. Esta ventana entra sin recortar; dejar el
    // cartel dibujado afirmaria que TAMBIEN se recorto, que es falso, y el usuario no tendria
    // forma de saber cual de las dos consultas describe.
    await page.getByLabel('Desde').fill(masDias(desde, 1));
    await expect(page.getByText('Lo recortamos y volvimos a pedirla.')).toHaveCount(0);
  });

  /**
   * Escenario 6. Un hueco en la grilla el usuario lo lee como "no atiende a esa hora", que es
   * una afirmacion distinta —y falsa— de "a esa hora atiende y ya se lleno".
   *
   * <p>Por eso no alcanza con que el slot lleno se vea: hay que afirmar tambien que <b>no es
   * accionable</b>. Un slot completo que sigue siendo boton lleva a una reserva que el backend
   * rechaza con `slot-completo`, que es el conflicto que la pantalla existe para evitar.
   */
  test('el slot completo se dibuja marcado y sin ser accionable, no se esconde', async ({
    page,
  }) => {
    api.agenda = (url) =>
      ok(agendaDe([diaConSlots(url.searchParams.get('desde') ?? '', { completoElPrimero: true })]));

    await page.goto('/agenda');
    await elegirLaOferta(page);

    // Los tres horarios se ven, el lleno incluido: la grilla no tiene huecos.
    await expect(page.getByText('09:00 a 09:45')).toBeVisible();
    await expect(page.getByText('09:45 a 10:30')).toBeVisible();
    await expect(page.getByText('10:30 a 11:15')).toBeVisible();
    await expect(page.getByText('Completo')).toBeVisible();

    // Pero solo dos son accionables, y el lleno no es uno de ellos.
    await expect(page.getByRole('button', { name: /09:00 a 09:45/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /09:45 a 10:30/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /10:30 a 11:15/ })).toBeVisible();
  });

  /**
   * Corolario del escenario 6 que vale la pena fijar: sin `turno:manage` el hueco se muestra
   * igual, sin ser accionable. Esconderlo dejaria la grilla llena de agujeros para quien solo
   * puede consultarla, que es el mismo malentendido.
   */
  test('sin permiso para reservar, los slots se ven pero ninguno es un boton', async ({ page }) => {
    api.permisos = ['tenant:read', 'turno:read'];

    await page.goto('/agenda');
    await elegirLaOferta(page);

    await expect(page.getByText('09:00 a 09:45')).toBeVisible();
    await expect(page.getByRole('button', { name: /09:00 a 09:45/ })).toHaveCount(0);
  });
});
