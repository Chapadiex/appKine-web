import { randomUUID } from 'node:crypto';

import { APIResponse, Page, expect, request as fabricaDeRequest } from '@playwright/test';

import { PASSWORD, campo, conReintentoPor429, esperarCupoDeRegistro } from './akine';
import { API, MAILPIT, activarPorMailpit } from './sembrado';

/**
 * Cuentas reales de punta a punta para los E2E de A-6 y B-6: alta, enlaces de correo, sesion y
 * Problem Details.
 *
 * <p>Nada pasa por SQL. Los enlaces se leen de <b>Mailpit</b>, que es a donde el backend manda el
 * correo con el perfil `local` (en el CI y en una pila aislada, ver `docs/e2e-ci.md`).
 */

/** Asuntos reales de los correos de identidad. Si el backend los cambia, estos E2E lo dicen. */
export const ASUNTO = {
  activacion: 'Activa tu cuenta de AKINE',
  restablecimiento: 'Restablece tu contrasena de AKINE',
} as const;

/**
 * El enlace del correo mas reciente con ese asunto para `email`, como RUTA RELATIVA
 * (`/auth/activar?token=...`).
 *
 * <p>El enlace es el que armo el backend, sin tocar. Se descarta solo el origen: lo fija
 * `AKINE_PUBLIC_BASE_URL` del backend, que en la pila aislada no coincide con el puerto del
 * frontend bajo prueba. Navegar la ruta contra el `baseURL` de Playwright es abrir ese mismo
 * enlace en el frontend que se esta probando.
 *
 * <p>`descartar` son IDs de Mailpit ya vistos: el segundo pedido de restablecimiento tiene el
 * mismo asunto que el primero, y Mailpit tarda unos segundos en recibir el correo nuevo.
 */
export async function enlaceDelCorreo(
  email: string,
  asunto: string,
  descartar: readonly string[] = [],
): Promise<{ readonly ruta: string; readonly token: string; readonly idCorreo: string }> {
  const correo = await fabricaDeRequest.newContext({ baseURL: MAILPIT });
  try {
    let hallado: { ruta: string; token: string; idCorreo: string } | undefined;
    await expect(async () => {
      const busqueda = await correo.get('/api/v1/search', {
        params: { query: `to:"${email}" subject:"${asunto}"` },
      });
      expect(busqueda.ok(), 'Mailpit responde').toBe(true);
      const { messages } = (await busqueda.json()) as { messages: { ID: string }[] };
      const nuevo = messages.find((m) => !descartar.includes(m.ID));
      expect(nuevo, `llego "${asunto}" a ${email}`).toBeDefined();
      const mensaje = await correo.get(`/api/v1/message/${nuevo!.ID}`);
      const { Text } = (await mensaje.json()) as { Text: string };
      const enlace = /https?:\/\/\S+[?&]token=[A-Za-z0-9_-]+/.exec(Text)?.[0];
      expect(enlace, 'el correo trae un enlace con su token').toBeDefined();
      const url = new URL(enlace!);
      hallado = {
        ruta: `${url.pathname}${url.search}`,
        token: url.searchParams.get('token')!,
        idCorreo: nuevo!.ID,
      };
    }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });
    return hallado!;
  } finally {
    await correo.dispose();
  }
}

/** Alta self-service por la API, respetando el cupo de 4 por minuto del backend. */
export async function registrarCuenta(
  datos: { email: string; organizationName: string; firstName?: string; lastName?: string },
  password: string = PASSWORD,
): Promise<void> {
  const http = await fabricaDeRequest.newContext({ baseURL: API });
  try {
    const clave = randomUUID();
    const respuesta = await conReintentoPor429(() =>
      http.post('/api/v1/auth/register', {
        headers: { 'Idempotency-Key': clave },
        data: {
          firstName: datos.firstName ?? 'Ana',
          lastName: datos.lastName ?? 'Prueba',
          email: datos.email,
          password,
          organizationName: datos.organizationName,
        },
      }),
    );
    expect(respuesta.status(), `alta de ${datos.email}: ${await respuesta.text()}`).toBe(202);
  } finally {
    await http.dispose();
  }
}

/** Alta self-service por la API y activacion con el enlace real del correo. */
export async function cuentaActiva(datos: {
  email: string;
  organizationName: string;
  firstName?: string;
  lastName?: string;
}): Promise<void> {
  await registrarCuenta(datos);
  const http = await fabricaDeRequest.newContext({ baseURL: API });
  try {
    await activarPorMailpit(http, datos.email);
  } finally {
    await http.dispose();
  }
}

/** Registro por PANTALLA. Pide cupo antes de enviar: el limite del backend no mira el origen. */
export async function registrarPorPantalla(
  page: Page,
  datos: { email: string; centro: string; password?: string },
): Promise<void> {
  await page.goto('/auth/registro');
  await campo(page, 'Nombre', { exact: true }).fill('Ana');
  await campo(page, 'Apellido').fill('Prueba');
  await campo(page, 'Email').fill(datos.email);
  await campo(page, 'Contrasena').fill(datos.password ?? PASSWORD);
  await campo(page, 'Nombre del centro').fill(datos.centro);
  await esperarCupoDeRegistro();
  await page.getByRole('button', { name: 'Crear la cuenta' }).click();
  await expect(page.getByText('Listo, ya lo estamos procesando.')).toBeVisible();
}

/** Login por pantalla con una contrasena cualquiera (el de `support/akine.ts` usa la fija). */
export async function ingresarCon(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/auth/ingresar');
  await campo(page, 'Email').fill(email);
  await campo(page, 'Contrasena').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesion' }).click();
}

/**
 * Afirma un Problem Details del backend real: el status y el `type`.
 *
 * <p>`tipo` va como URI completa a proposito: es la forma que `npm run api:check` reconoce y
 * contrasta contra el enum `ProblemType` del contrato, asi que un tipo inventado rompe el gate
 * antes de llegar a correr.
 */
export async function esperarProblema(
  respuesta: APIResponse | { status(): number; json(): Promise<unknown>; url(): string },
  status: number,
  tipo: `https://akine.app/problems/${string}`,
): Promise<Record<string, unknown>> {
  const cuerpo = (await respuesta.json()) as Record<string, unknown>;
  expect(respuesta.status(), `${respuesta.url()} respondio ${JSON.stringify(cuerpo)}`).toBe(status);
  expect(cuerpo['type'], `problemType de ${respuesta.url()}`).toBe(tipo);
  return cuerpo;
}
