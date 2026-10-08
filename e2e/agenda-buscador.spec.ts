import {
  abrirLaAgenda,
  expect,
  ingresar,
  navegar,
  problemaDe,
  respuestaDe,
  test,
} from './support/agenda-real';
import {
  DIAS,
  crearOferta,
  crearPersona,
  diaDeTrabajo,
  fechaLocal,
  rango,
  reservar,
  slotsDelDia,
  sumarDias,
  uriDeProblema,
  ventanaHabil,
} from './support/sembrado';

/**
 * E2E del buscador de agenda (M12, AKINE-05.01) contra el backend REAL (AKINE E-2).
 *
 * <p>Las mismas tres afirmaciones que la version con `route.fulfill`, ahora con el motor de
 * slots de verdad detras: ningun dia se omite y cada dia vacio dice su motivo, la ventana de mas
 * de 62 dias se recorta sola, y el slot completo se dibuja marcado. Lo que la version simulada no
 * podia probar —y esta si— es que el backend emita esos motivos y ese 400 con esos nombres.
 *
 * <p>Fuera de esta suite queda "sin permiso para reservar": todos los roles de tenant tienen
 * `turno:manage` (ver `RolePermissions`), asi que con el backend real no hay cuenta con la que
 * montarlo sin quitar un permiso a mano. Lo sigue cubriendo `buscador-de-agenda-page.spec.ts`.
 */

test.describe('Buscador de agenda contra el backend real', () => {
  test.beforeEach(async ({ page, centro }) => {
    await ingresar(page, centro);
  });

  /**
   * Cinco dias seguidos y ninguno omitido: dos con turno, un cierre del profesional, un dia lleno
   * y la oferta fuera de vigencia. Todos montados con los endpoints del producto, ninguno por SQL.
   *
   * <p><b>El dia lleno viaja sin slots y con `motivoSinSlots: COMPLETO`</b> desde appKine-api #66.
   * Hasta entonces el backend nunca emitia ese motivo y devolvia el slot con `cupoLibre: 0`. Un dia
   * con algun lugar libre sigue dibujando sus slots llenos marcados: eso lo cubre el ultimo test.
   */
  test('ningun dia de la ventana se omite y cada dia vacio muestra su motivo', async ({
    page,
    api,
    centro,
  }) => {
    // Cuatro dias habiles seguidos, sin un feriado nacional en el medio que cambie los motivos.
    const sonda = await crearOferta(api, centro);
    const d = await ventanaHabil(api, centro, sonda.id, DIAS.buscadorMotivos, 4);

    // Turnos de 12 horas: con la franja de 00:00 a 23:45 entra UNO por dia, asi que llenar un
    // dia es una sola reserva. Vigente hasta d+3 inclusive: d+4 queda fuera.
    const oferta = await crearOferta(api, centro, {
      duracionMinutos: 720,
      vigenciaHasta: sumarDias(d, 3),
    });

    // d+1: el profesional no atiende por una excepcion de cierre (licencia).
    await api.exigir('POST', `/api/v1/consultorios/${centro.consultorioId}/excepciones`, {
      tipo: 'CIERRE',
      motivo: 'LICENCIA',
      membershipId: centro.profesional.membershipId,
      fechaDesde: sumarDias(d, 1),
      fechaHasta: sumarDias(d, 2),
    });

    // d+2: el unico turno del dia, tomado.
    const persona = await crearPersona(api);
    const [unico] = await slotsDelDia(api, centro, oferta.id, sumarDias(d, 2));
    await reservar(api, centro, oferta.id, persona.id, unico.desde);

    const primerDia = await slotsDelDia(api, centro, oferta.id, d);
    await abrirLaAgenda(page, oferta, d, sumarDias(d, 5));

    // Los cinco dias dibujados: ninguno se salteo por venir vacio.
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(5);

    // d y d+3 ofrecen su turno; los otros tres dicen cada uno por que no.
    await expect(
      page.getByRole('button', { name: rango(primerDia[0], centro.timezone) }),
    ).toHaveCount(2);
    await expect(
      page.getByText('La sede cierra este dia por una excepcion cargada en el calendario.'),
    ).toBeVisible();
    // Desde appKine-api #66 un dia sin ningun cupo libre viaja SIN slots y con `COMPLETO`: ya no
    // se dibuja el turno tomado con cupo 0, se dice que el dia se lleno.
    await expect(
      page.getByText(
        'Todos los turnos de este dia ya estan reservados. La agenda esta bien: se lleno.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: rango(unico, centro.timezone) })).toHaveCount(0);
    await expect(page.getByText('La oferta no esta vigente este dia.')).toBeVisible();

    await expect(page.getByText('Ningun dia de este rango tiene turnos disponibles')).toHaveCount(
      0,
    );
  });

  /**
   * El 400 `ventana-demasiado-amplia` del backend real trae `maxDays`, y con ese numero la
   * pantalla recorta y vuelve a pedir. Se afirma el problema TAL COMO LO EMITIO el servidor.
   */
  test('la ventana de mas de 62 dias se recorta sola y se reintenta, sin mostrar un error', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const desde = fechaLocal(centro.timezone);
    await navegar(page, '/agenda');
    await page.getByLabel('Oferta', { exact: true }).selectOption({ label: oferta.nombre });
    await expect(page.getByRole('heading', { name: oferta.nombre, level: 2 })).toBeVisible();

    const rechazo = respuestaDe(page, 'GET', /\/ofertas\/\d+\/agenda$/);
    await page.getByLabel('Hasta (sin incluir)').fill(sumarDias(desde, 120));

    const respuesta = await rechazo;
    expect(respuesta.status()).toBe(400);
    const problema = await problemaDe(respuesta);
    expect(problema.type).toBe(uriDeProblema('ventana-demasiado-amplia'));
    expect(problema['maxDays']).toBe(62);

    await expect(page.getByText('Lo recortamos y volvimos a pedirla.')).toBeVisible();
    await expect(page.getByLabel('Hasta (sin incluir)')).toHaveValue(sumarDias(desde, 62));
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(62);
  });

  /**
   * Un hueco en la grilla se lee como "no atiende a esa hora". El slot que el backend devuelve con
   * `cupoLibre: 0` tiene que verse, marcado, y no ser un boton.
   */
  test('el slot completo se dibuja marcado y sin ser accionable, no se esconde', async ({
    page,
    api,
    centro,
  }) => {
    const oferta = await crearOferta(api, centro);
    const {
      fecha: d,
      slots: [primero, segundo],
    } = await diaDeTrabajo(api, centro, oferta.id, DIAS.buscadorSlotCompleto);
    await reservar(api, centro, oferta.id, (await crearPersona(api)).id, primero.desde);

    await abrirLaAgenda(page, oferta, d, sumarDias(d, 1));

    await expect(page.getByText(rango(primero, centro.timezone))).toBeVisible();
    await expect(page.getByText('Completo', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: rango(primero, centro.timezone) })).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: rango(segundo, centro.timezone) })).toBeVisible();
  });
});
