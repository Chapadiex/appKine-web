import { APIRequestContext, APIResponse, expect, test } from '@playwright/test';

import {
  PASSWORD,
  campo,
  emailUnico,
  esperarSinInternals,
  ingresarPorPantalla,
  nonce,
  registrarPorApi,
} from './support/akine';

/**
 * ESCENARIO 11 de `../appKine-api/docs/tests-diferidos.md` — errores sin internals.
 *
 * <p>Ninguna respuesta de error puede contener `com.akine`, `org.springframework` ni
 * `stacktrace` (ADR-0005). Se provoca por VARIAS vias, no una sola: una unica ruta 404 solo
 * prueba el handler de 404, no el resto de la cadena.
 *
 * <p>Todo golpea el backend real a traves del proxy de dev. No hay respuestas simuladas.
 */

interface CasoDeError {
  readonly nombre: string;
  readonly ejecutar: (request: APIRequestContext) => Promise<Respuesta>;
}

interface Respuesta {
  readonly status: number;
  readonly cuerpo: string;
}

async function leer(respuesta: APIResponse): Promise<Respuesta> {
  return { status: respuesta.status(), cuerpo: await respuesta.text() };
}

const EMAIL_LARGO = `${'a'.repeat(5000)}@ejemplo.test`;

const CASOS: readonly CasoDeError[] = [
  {
    nombre: 'ruta inexistente bajo /api/v1',
    ejecutar: async (request) => leer(await request.get('/api/v1/no-existe')),
  },
  {
    nombre: 'endpoint de negocio sin credencial',
    ejecutar: async (request) => leer(await request.get('/api/v1/organizations/1')),
  },
  {
    nombre: 'bearer que no es un JWT',
    ejecutar: async (request) =>
      leer(
        await request.get('/api/v1/me/contexts', {
          headers: { Authorization: 'Bearer no-es-un-jwt' },
        }),
      ),
  },
  {
    nombre: 'JWT con firma invalida',
    ejecutar: async (request) =>
      leer(
        await request.get('/api/v1/me/contexts', {
          headers: {
            Authorization:
              'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwic2NvcGUiOiJjb250ZXh0Iiwib3JnIjoxfQ.firma-falsa',
          },
        }),
      ),
  },
  {
    nombre: 'credenciales incorrectas',
    ejecutar: async (request) =>
      leer(
        await request.post('/api/v1/auth/login', {
          data: { email: emailUnico('qa.err.inexistente'), password: 'x' },
        }),
      ),
  },
  {
    nombre: 'JSON sintacticamente roto',
    ejecutar: async (request) =>
      leer(
        await request.post('/api/v1/auth/login', {
          headers: { 'Content-Type': 'application/json' },
          data: '{"email":',
        }),
      ),
  },
  {
    nombre: 'tipos equivocados en el cuerpo',
    ejecutar: async (request) =>
      leer(
        await request.post('/api/v1/auth/login', {
          headers: { 'Content-Type': 'application/json' },
          data: '{"email":{"a":1},"password":[1,2]}',
        }),
      ),
  },
  {
    nombre: 'Content-Type no soportado',
    ejecutar: async (request) =>
      leer(
        await request.post('/api/v1/auth/login', {
          headers: { 'Content-Type': 'text/plain' },
          data: 'hola',
        }),
      ),
  },
  {
    nombre: 'header Idempotency-Key obligatorio ausente',
    ejecutar: async (request) =>
      leer(await request.post('/api/v1/auth/register', { data: { email: 'a@ejemplo.test' } })),
  },
  {
    nombre: 'campo que excede el maximo declarado',
    ejecutar: async (request) =>
      leer(await request.post('/api/v1/auth/password-reset', { data: { email: EMAIL_LARGO } })),
  },
  {
    nombre: 'id de path no numerico',
    ejecutar: async (request) => leer(await request.get('/api/v1/organizations/abc')),
  },
  {
    nombre: 'metodo no permitido',
    ejecutar: async (request) => leer(await request.delete('/api/v1/version')),
  },
  {
    nombre: 'token de activacion invalido',
    ejecutar: async (request) =>
      leer(await request.post('/api/v1/auth/activate', { data: { token: 'no-existe' } })),
  },
  {
    nombre: 'token de restablecimiento invalido',
    ejecutar: async (request) =>
      leer(
        await request.post('/api/v1/auth/password-reset/confirm', {
          data: { token: 'no-existe', newPassword: PASSWORD },
        }),
      ),
  },
  {
    nombre: 'inyeccion SQL en las credenciales',
    ejecutar: async (request) =>
      leer(
        await request.post('/api/v1/auth/login', {
          data: {
            email: "' OR 1=1 --@ejemplo.test",
            password: "'; DROP TABLE cuenta; --",
          },
        }),
      ),
  },
  {
    nombre: 'seleccion de contexto sin sesion',
    ejecutar: async (request) =>
      leer(
        await request.post('/api/v1/auth/context', {
          data: { organizationId: 999999, consultorioId: 999999 },
        }),
      ),
  },
];

test.describe('Escenario 11 - ningun error expone internals del servidor', () => {
  for (const caso of CASOS) {
    test(`${caso.nombre}: el error no filtra internals`, async ({ request }) => {
      const { status, cuerpo } = await caso.ejecutar(request);

      expect(status, `"${caso.nombre}" tiene que ser un error`).toBeGreaterThanOrEqual(400);
      esperarSinInternals(cuerpo, `la respuesta de "${caso.nombre}" (HTTP ${status})`);
    });
  }

  test('los errores llegan como ProblemDetail propio, no como la pagina de error de Spring', async ({
    request,
  }) => {
    // La whitelabel de Spring es la fuga clasica: llega como text/html con la clase de la
    // excepcion adentro. Que el cuerpo sea problem+json con un `type` propio es lo que prueba
    // que el handler de AKINE esta interceptando, y no que tuvimos suerte con el texto.
    for (const ruta of ['/api/v1/no-existe', '/api/v1/organizations/1', '/api/v1/me/contexts']) {
      const respuesta = await request.get(ruta);
      const tipo = respuesta.headers()['content-type'] ?? '';

      expect(tipo, `${ruta} responde JSON`).toContain('json');
      expect(tipo, `${ruta} no puede responder la pagina HTML de error de Spring`).not.toContain(
        'text/html',
      );

      const problema = JSON.parse(await respuesta.text()) as Record<string, unknown>;
      expect(problema['type'], `${ruta} declara un tipo de problema propio`).toEqual(
        expect.stringContaining('akine.app/problems/'),
      );

      // Los campos que filtran el stack el dia que alguien habilita
      // `server.error.include-stacktrace` sin querer.
      for (const delator of ['trace', 'exception', 'stackTrace', 'cause']) {
        expect(problema[delator], `${ruta} no puede traer el campo "${delator}"`).toBeUndefined();
      }
    }
  });

  test('la pantalla de login no pinta internals cuando el backend rechaza', async ({ page }) => {
    await page.goto('/auth/ingresar');
    await campo(page, 'Email').fill(emailUnico('qa.err.pantalla'));
    await campo(page, 'Contrasena').fill(PASSWORD);
    await page.getByRole('button', { name: 'Iniciar sesion' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    esperarSinInternals(await page.locator('body').innerText(), 'la pantalla de login con error');
  });

  test('las pantallas de organizacion no pintan internals cuando falta contexto', async ({
    page,
    request,
  }) => {
    const email = emailUnico('qa.err.org');
    await registrarPorApi(request, { email, organizationName: `Centro Error ${nonce()}` });

    // URL directa sin sesion: el caso adverso, y el que mas facil se cae con un error crudo.
    await page.goto('/organizacion');
    esperarSinInternals(
      await page.locator('body').innerText(),
      'la pantalla de organizacion sin contexto',
    );

    await page.goto('/organizacion/suscripcion');
    esperarSinInternals(
      await page.locator('body').innerText(),
      'la pantalla de suscripcion sin contexto',
    );

    await page.goto('/seleccionar-contexto');
    esperarSinInternals(
      await page.locator('body').innerText(),
      'el selector de contexto sin sesion',
    );
  });

  test('la consola del navegador tampoco recibe internals del backend', async ({ page }) => {
    // Un mensaje sanitizado en pantalla no sirve de nada si el objeto de error crudo termina
    // en la consola: es el mismo dato, un F12 mas lejos.
    const consola: string[] = [];
    page.on('console', (mensaje) => consola.push(mensaje.text()));
    page.on('pageerror', (error) => consola.push(error.stack ?? error.message));

    await ingresarPorPantalla(page, emailUnico('qa.err.consola'));
    await expect(page.getByRole('alert')).toBeVisible();

    await page.goto('/organizacion');
    await expect(page.getByRole('banner')).toBeVisible();

    esperarSinInternals(consola.join('\n'), 'la consola del navegador');
  });
});
