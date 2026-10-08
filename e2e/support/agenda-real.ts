import { Page, Response, expect, test as base } from '@playwright/test';

import { ingresarPorPantalla } from './akine';
import { ApiAkine, Centro, Oferta, Persona, Slot, deAUnLogin, leerCentro } from './sembrado';

/**
 * Fixtures de los E2E de agenda, ciclo del turno y recepcion contra el backend real (AKINE E-2).
 *
 * <p>`centro` y `api` son de WORKER: se leen e ingresan una vez por proceso y no una por test.
 * El sembrado del centro lo hace el proyecto `agenda-setup` (ver `support/sembrado.ts`).
 *
 * <p>Lo unico que queda de test es el navegador: cada test ingresa por pantalla con su propia
 * sesion. Compartir la cookie de refresh entre tests paralelos haria chocar la rotacion estricta
 * del backend, que invalida el refresh presentado y cierra la familia entera.
 */
export const test = base.extend<object, { centro: Centro; api: ApiAkine }>({
  centro: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, usar) => {
      await usar(leerCentro());
    },
    { scope: 'worker' },
  ],
  api: [
    async ({ centro }, usar) => {
      const api = await ApiAkine.como(centro.emailAdmin);
      await usar(api);
      await api.cerrar();
    },
    { scope: 'worker' },
  ],
});

export { expect };

/** Ingresa por pantalla como la administradora y espera a quedar adentro de su centro. */
export async function ingresar(page: Page, centro: Centro): Promise<void> {
  // De a un login por vez en toda la corrida: ver `deAUnLogin`, es un defecto del backend.
  await deAUnLogin(async () => {
    await ingresarPorPantalla(page, centro.emailAdmin);
    // Con un solo contexto el selector no pregunta y entra solo.
    await expect(page).not.toHaveURL(/\/(auth|seleccionar-contexto)/, { timeout: 15_000 });
  });
}

/**
 * Navega DENTRO de la aplicacion ya cargada, sin recargar la pagina.
 *
 * <p>`page.goto` recarga, y cada recarga canjea el refresh contra `/auth/refresh`, que comparte
 * un limite de 30 por minuto y por IP: con dos workers la suite lo pasaba y los tests terminaban
 * en el login por un 429 que no es del producto. `pushState` + `popstate` es lo mismo que hace el
 * boton "atras" del navegador: el router de Angular navega y la sesion en memoria sigue viva,
 * igual que cuando la persona va de pantalla en pantalla.
 */
export async function navegar(page: Page, ruta: string): Promise<void> {
  await page.evaluate((destino) => {
    history.pushState(null, '', destino);
    dispatchEvent(new PopStateEvent('popstate', { state: null }));
  }, ruta);
  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === ruta);
}

/**
 * Espera la respuesta de un POST cuya ruta termina como `sufijo`.
 *
 * <p>Se usa para afirmar el `type` REAL que emitio el backend, no solo la reaccion de la pantalla:
 * es exactamente lo que los E2E con `route.fulfill` no podian probar.
 */
export function respuestaDe(page: Page, metodo: string, sufijo: RegExp): Promise<Response> {
  return page.waitForResponse(
    (r) => r.request().method() === metodo && sufijo.test(new URL(r.url()).pathname),
  );
}

/** Lee el Problem Details de una respuesta de error. */
export async function problemaDe(
  respuesta: Response,
): Promise<{ type: string; status: number; [extension: string]: unknown }> {
  return (await respuesta.json()) as { type: string; status: number };
}

/** Elige a la persona en el padron como lo hace el mostrador: escribiendo su apellido. */
export async function elegirPersona(page: Page, persona: Persona): Promise<void> {
  await page.getByLabel('Documento, apellido, nombre o telefono').fill(persona.apellido);
  await page.getByRole('button', { name: `${persona.apellido}, ${persona.nombre}` }).click();
  await expect(page.getByText(`${persona.apellido}, ${persona.nombre}`)).toBeVisible();
}

/** Abre la reserva de un slot por su URL —la misma que arma el buscador— y elige a la persona. */
export async function abrirReserva(
  page: Page,
  oferta: Oferta,
  fecha: string,
  slot: Slot,
  persona: Persona,
): Promise<void> {
  const query = new URLSearchParams({
    fecha,
    inicio: slot.desde,
    profesionalId: String(slot.profesionalId),
  });
  await navegar(page, `/agenda/ofertas/${oferta.id}/reservar?${query.toString()}`);
  await expect(page.getByRole('heading', { name: 'Resumen', level: 2 })).toBeVisible();
  await expect(page.getByText(oferta.nombre)).toBeVisible();
  await elegirPersona(page, persona);
}

/** POST de la reserva de turno. */
export const RESERVA = /\/turnos\/ofertas\/\d+$/;

/**
 * Abre el buscador con la oferta elegida y la ventana [desde, hasta), y espera a que la grilla
 * dibuje ESA ventana.
 *
 * <p>Esperar la respuesta de esa consulta, y no solo que el campo tenga el valor, no es exceso de
 * celo: mientras la consulta nueva viaja la grilla sigue mostrando la anterior, y un localizador
 * que matchea varios slots de la grilla vieja falla en el acto por modo estricto.
 */
export async function abrirLaAgenda(
  page: Page,
  oferta: Oferta,
  desde: string,
  hasta: string,
): Promise<void> {
  await navegar(page, '/agenda');
  await page.getByLabel('Oferta', { exact: true }).selectOption({ label: oferta.nombre });
  await expect(page.getByRole('heading', { name: oferta.nombre, level: 2 })).toBeVisible();

  const consulta = page.waitForResponse((r) => {
    const url = new URL(r.url());
    return (
      url.pathname.endsWith('/agenda') &&
      url.searchParams.get('desde') === desde &&
      url.searchParams.get('hasta') === hasta
    );
  });
  // Primero `hasta`: con `desde` adelante de `hasta` la ventana quedaria invertida un instante.
  await page.getByLabel('Hasta (sin incluir)').fill(hasta);
  await page.getByLabel('Desde').fill(desde);
  expect((await consulta).status()).toBe(200);

  const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000;
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(dias);
}
