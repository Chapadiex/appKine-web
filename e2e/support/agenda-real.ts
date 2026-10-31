import { Locator, Page, Response, expect, test as base } from '@playwright/test';

import { ingresarPorPantalla } from './akine';
import {
  ApiAkine,
  Centro,
  Oferta,
  Persona,
  Slot,
  deAUnLogin,
  esperaDel429,
  leerCentro,
  rango,
  sumarDias,
} from './sembrado';

/**
 * Fixtures de los E2E de agenda, panel del turno y recepcion contra el backend real (AKINE E-2).
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
      // El worker que reinicia un test fallido reusa el token en vez de volver a ingresar: ver
      // `ARCHIVO_DE_SESIONES` en `support/sembrado.ts`.
      const api = await ApiAkine.como(centro.emailAdmin, { reusarSesion: true });
      await usar(api);
      await api.cerrar();
    },
    { scope: 'worker' },
  ],
});

export { expect };

/**
 * Ingresa por pantalla como la administradora y espera a quedar adentro de su centro.
 *
 * <p>Un 429 del login no es el producto fallando sino el limite de 30 por minuto y por IP que
 * comparten todos los workers: se espera lo que pide `Retry-After` y se vuelve a ingresar, hasta
 * tres intentos. Sin esto un test que fallaba y se reintentaba consumia el cupo de los siguientes.
 */
export async function ingresar(page: Page, centro: Centro): Promise<void> {
  for (let intento = 1; ; intento++) {
    // De a un login por vez en toda la corrida: ver `deAUnLogin`, es un defecto del backend.
    const espera = await deAUnLogin(async () => {
      const login = page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/auth/login'),
      );
      await ingresarPorPantalla(page, centro.emailAdmin);
      const respuesta = await login;
      if (respuesta.status() === 429 && intento < 3) {
        return esperaDel429(respuesta);
      }
      // Con un solo contexto el selector no pregunta y entra solo.
      await expect(page).not.toHaveURL(/\/(auth|seleccionar-contexto)/, { timeout: 15_000 });
      return 0;
    });
    if (espera === 0) {
      return;
    }
    await page.waitForTimeout(espera * 1_000);
  }
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

/** El panel lateral del flujo unico de turnos: un `dialog` con el titulo de lo que se esta haciendo. */
export function panelDeTurno(page: Page, titulo = 'Nuevo turno'): Locator {
  return page.getByRole('dialog', { name: titulo });
}

/** La region de los avisos globales (UX-12), donde termina el resultado de cada operacion. */
export function avisos(page: Page): Locator {
  return page.getByRole('region', { name: 'Notificaciones', exact: true });
}

/** Elige a la persona en el panel como lo hace el mostrador: escribiendo su apellido. */
export async function elegirPersona(panel: Locator, persona: Persona): Promise<void> {
  const nombre = `${persona.apellido}, ${persona.nombre}`;
  await panel.getByLabel('Buscar paciente').fill(persona.apellido);
  await panel.getByRole('button', { name: new RegExp(`^${nombre}`) }).click();
  await expect(panel.locator('.flujo__persona-elegida')).toContainText(nombre);
}

/** POST de la reserva de turno. */
export const RESERVA = /\/turnos\/ofertas\/\d+$/;

/** POST con el que el panel le pregunta al motor si el horario sigue libre. */
export const VALIDACION = /\/disponibilidad\/validacion$/;

/**
 * Espera que el panel sepa de `oferta`. Devuelve el selector de prestaciones, o `null` si la sede tiene
 * una sola y entonces es un dato y no una pregunta.
 *
 * <p>Se espera la opcion y no el selector: hasta que las prestaciones llegan, el panel dibuja un selector
 * vacio, que desaparece si resulta haber una sola.
 */
async function prestacionDelPanel(panel: Locator, oferta: Oferta): Promise<Locator | null> {
  const dato = panel.locator('.flujo__dato', { hasText: oferta.nombre });
  const selector = panel.getByLabel('Prestación', { exact: true });
  await expect(dato.or(selector.locator(`option[value="${oferta.id}"]`)).first()).toBeAttached();
  return (await dato.count()) > 0 ? null : selector;
}

/**
 * Abre el panel de reserva como lo abre el mostrador —un horario libre de la busqueda de
 * disponibilidad— y elige a la persona. Vuelve con el panel listo para confirmar.
 *
 * <p>Espera la validacion que sale con la persona ya elegida: es la ultima lectura del panel antes de
 * confirmar. Un test de conflicto que arme el choque antes de que esa respuesta llegue no ve el 409 de
 * la reserva, sino un "Confirmar" apagado por una validacion que ya vio el horario tomado.
 */
export async function abrirReserva(
  page: Page,
  centro: Centro,
  oferta: Oferta,
  fecha: string,
  slot: Slot,
  persona: Persona,
): Promise<Locator> {
  await abrirLaDisponibilidad(page, oferta, fecha, sumarDias(fecha, 1));
  await page.getByRole('button', { name: rango(slot, centro.timezone) }).click();

  const panel = panelDeTurno(page);
  await expect(panel).toBeVisible();
  const selector = await prestacionDelPanel(panel, oferta);
  if (selector !== null) {
    // Viene elegida: es la del horario.
    await expect(selector).toHaveValue(String(oferta.id));
  }

  const validacion = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      VALIDACION.test(new URL(r.url()).pathname) &&
      (r.request().postDataJSON() as { personaId?: number }).personaId === persona.id,
  );
  await elegirPersona(panel, persona);
  await validacion;
  await expect(panel.getByRole('button', { name: 'Confirmar turno' })).toBeEnabled();
  return panel;
}

/**
 * Abre la busqueda de disponibilidad con la prestacion elegida y la ventana [desde, hasta), y espera
 * a que la grilla dibuje ESA ventana.
 *
 * <p>Esperar la respuesta de esa consulta, y no solo que el campo tenga el valor, no es exceso de
 * celo: mientras la consulta nueva viaja la grilla sigue mostrando la anterior, y un localizador
 * que matchea varios slots de la grilla vieja falla en el acto por modo estricto.
 */
export async function abrirLaDisponibilidad(
  page: Page,
  oferta: Oferta,
  desde: string,
  hasta: string,
): Promise<void> {
  await navegar(page, '/agenda/disponibilidad');
  await page.getByLabel('Prestación', { exact: true }).selectOption({ label: oferta.nombre });
  await expect(page.getByRole('heading', { name: oferta.nombre, level: 2 })).toBeVisible();

  const consulta = page.waitForResponse((r) => {
    const url = new URL(r.url());
    return (
      url.pathname.endsWith('/agenda') &&
      url.searchParams.get('desde') === desde &&
      url.searchParams.get('hasta') === hasta
    );
  });
  // Primero `desde`. Al reves, una fecha lejana ensancha la ventana de hoy a mas de 62 dias: la
  // pantalla la recorta sola y pisa el `hasta`. Asi la ventana puede quedar invertida un instante,
  // pero esa consulta se cancela con la siguiente.
  await page.getByLabel('Desde').fill(desde);
  await page.getByLabel('Hasta (sin incluir)').fill(hasta);
  expect((await consulta).status()).toBe(200);

  const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000;
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(dias);
}

/**
 * Abre "Programar varias sesiones" como se abre fuera de un plan: desde "Nuevo turno", con la persona
 * y la prestacion elegidas, por el enlace que aparece debajo de los horarios.
 */
export async function abrirProgramacion(
  page: Page,
  oferta: Oferta,
  persona: Persona,
): Promise<Locator> {
  await navegar(page, '/agenda');
  await page.getByRole('button', { name: 'Nuevo turno', exact: true }).click();
  const nuevo = panelDeTurno(page);
  await elegirPersona(nuevo, persona);
  const selector = await prestacionDelPanel(nuevo, oferta);
  await selector?.selectOption(String(oferta.id));
  await nuevo.getByRole('button', { name: 'Programar varias sesiones' }).click();

  const panel = panelDeTurno(page, 'Programar varias sesiones');
  await expect(panel.getByLabel('Prestación', { exact: true })).toHaveValue(String(oferta.id));
  return panel;
}

/** Los dias del panel de la serie, por dia ISO: el 1 es el lunes. */
const DIA_DEL_PANEL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

/**
 * Completa la regla de la serie —una vez por semana, el dia de `fecha`, a `horaLocal`— y pide la
 * previsualizacion, que es del backend y todavia no crea nada.
 */
export async function previsualizarSerie(
  panel: Locator,
  fecha: string,
  horaLocal: string,
  cantidad: number,
): Promise<void> {
  const diaIso = new Date(`${fecha}T00:00:00Z`).getUTCDay() || 7;
  await panel.getByLabel('Horario preferido').fill(horaLocal);
  await panel.getByLabel('Fecha inicial').fill(fecha);
  await panel.getByLabel('Cantidad de sesiones').fill(String(cantidad));
  await panel.getByLabel(DIA_DEL_PANEL[diaIso - 1], { exact: true }).check();
  await panel.getByRole('button', { name: 'Buscar disponibilidad' }).click();
  await expect(panel.getByRole('table').locator('tbody tr')).toHaveCount(cantidad);
}
