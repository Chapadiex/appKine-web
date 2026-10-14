import { randomUUID } from 'node:crypto';

import { expect, request as fabricaDeRequest, test } from '@playwright/test';

import { PASSWORD, campo, emailUnico, nonce, sql } from './support/akine';
import {
  ASUNTO,
  cuentaActiva,
  enlaceDelCorreo,
  esperarProblema,
  ingresarCon,
  registrarPorPantalla,
} from './support/cuentas';
import { API, ApiAkine, ingresarComoPlataforma } from './support/sembrado';

/**
 * Ciclo de una cuenta contra el backend REAL, sin atajos (AKINE A-6).
 *
 * <p>`auth-flujo.spec.ts` (01.02) activaba la cuenta por SQL y no canjeaba ningun enlace: en modo
 * `log` el backend no deja el token en claro en ningun lado. Con el perfil `local` el correo sale
 * por SMTP a Mailpit, asi que aca los dos enlaces —activacion y restablecimiento— se abren tal
 * cual llegaron, en la pantalla que los recibe, y se verifica que son de un solo uso.
 *
 * <p>Lo que la API de auditoria NO puede mostrar, y por que: los hechos de identidad (alta,
 * activacion, login, restablecimiento) se graban con `organization_id` nulo —son de la persona, que
 * es global (ADR-0009)— y `GET /organizations/{orgId}/audit-events` filtra por organizacion. No hay
 * lectura de auditoria de plataforma en el contrato. Esos se leen de la tabla, en modo lectura y
 * declarado; los del tenant (rechazo de permiso, vinculo de colaborador) se verifican por la API y
 * por la pantalla de Auditoria.
 */

/** Contrasena nueva del restablecimiento. Sintetica y distinta de {@link PASSWORD}. */
const PASSWORD_NUEVA = 'otra-contrasena-larga-y-unica-2026';

/** Hechos de identidad de una cuenta, en orden. Ver la cabecera: la API no los expone. */
function hechosDeIdentidad(email: string): string[] {
  const salida = sql(
    `SELECT a.event_type FROM audit_event a JOIN cuenta c ON a.entity_id = c.id` +
      ` WHERE a.entity_type = 'Cuenta' AND a.organization_id IS NULL` +
      ` AND c.email_normalizado = '${email.toLowerCase()}' ORDER BY a.id`,
  );
  return salida === '' ? [] : salida.split('\n');
}

test.describe('Cuenta de punta a punta contra el backend real (A-6)', () => {
  test('registro, activacion por el enlace del correo, login y restablecimiento con canje real', async ({
    page,
  }) => {
    const email = emailUnico('a6.ciclo');
    const centro = `Centro Ciclo ${nonce()}`;
    const http = await fabricaDeRequest.newContext({ baseURL: API });

    try {
      // --- Registro por pantalla: crea la cuenta y su organizacion en un acto -----------------
      await registrarPorPantalla(page, { email, centro });

      // --- Activacion: el enlace del correo, abierto en la pantalla que lo recibe -------------
      const activacion = await enlaceDelCorreo(email, ASUNTO.activacion);
      expect(activacion.ruta).toMatch(/^\/auth\/activar\?token=/);
      await page.goto(activacion.ruta);
      await expect(page.getByText('Tu cuenta quedo activa.')).toBeVisible();

      // El enlace es de un solo uso: abrirlo de nuevo falla con un mensaje y sin internals, y el
      // backend lo rechaza con su tipo propio.
      await page.goto(activacion.ruta);
      await expect(page.getByRole('alert')).toBeVisible();
      await esperarProblema(
        await http.post('/api/v1/auth/activate', { data: { token: activacion.token } }),
        400,
        'https://akine.app/problems/invalid-token',
      );

      // --- Login por pantalla: con un solo contexto entra directo a su centro -----------------
      await ingresarCon(page, email, PASSWORD);
      await expect(page).toHaveURL(/\/organizacion/);
      await expect(page.getByText(centro, { exact: true })).toBeVisible();

      // --- Restablecimiento: se pide sin sesion, como quien se olvido la contrasena -----------
      await page.context().clearCookies();
      await page.goto('/auth/olvide-mi-contrasena');
      await campo(page, 'Email').fill(email);
      await page.getByRole('button', { name: 'Enviar el enlace' }).click();
      await expect(page.getByText('Solicitud recibida.')).toBeVisible();

      const restablecimiento = await enlaceDelCorreo(email, ASUNTO.restablecimiento);
      expect(restablecimiento.ruta).toMatch(/^\/auth\/restablecer\?token=/);
      await page.goto(restablecimiento.ruta);
      await campo(page, 'Contrasena nueva').fill(PASSWORD_NUEVA);
      await campo(page, 'Repetir la contrasena').fill(PASSWORD_NUEVA);
      await page.getByRole('button', { name: 'Guardar la contrasena' }).click();
      await expect(page.getByText('Listo.', { exact: true })).toBeVisible();

      // El mismo enlace ya no sirve: ni por pantalla ni por la API.
      await page.goto(restablecimiento.ruta);
      await campo(page, 'Contrasena nueva').fill(PASSWORD_NUEVA);
      await campo(page, 'Repetir la contrasena').fill(PASSWORD_NUEVA);
      await page.getByRole('button', { name: 'Guardar la contrasena' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await esperarProblema(
        await http.post('/api/v1/auth/password-reset/confirm', {
          data: { token: restablecimiento.token, password: PASSWORD_NUEVA },
        }),
        400,
        'https://akine.app/problems/invalid-token',
      );

      // --- La contrasena vieja dejo de valer y la nueva entra --------------------------------
      await esperarProblema(
        await http.post('/api/v1/auth/login', { data: { email, password: PASSWORD } }),
        401,
        'https://akine.app/problems/invalid-credentials',
      );
      await ingresarCon(page, email, PASSWORD);
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page).toHaveURL(/\/auth\/ingresar/);

      await ingresarCon(page, email, PASSWORD_NUEVA);
      await expect(page).toHaveURL(/\/organizacion/);
      await expect(page.getByText(centro, { exact: true })).toBeVisible();

      // --- Auditoria del tenant, por la API: el alta self-service quedo en SU organizacion -----
      const fundadora = await ApiAkine.como(email, { password: PASSWORD_NUEVA });
      try {
        const [{ organizationId }] = await fundadora.exigir<{ organizationId: number }[]>(
          'GET',
          '/api/v1/me/contexts',
        );
        const desde = new Date(Date.now() - 60 * 60_000).toISOString();
        const hasta = new Date(Date.now() + 60 * 60_000).toISOString();
        const pagina = await fundadora.exigir<{ content: { eventType: string }[] }>(
          'GET',
          `/api/v1/organizations/${organizationId}/audit-events?from=${desde}&to=${hasta}&size=100`,
        );
        const delTenant = pagina.content.map((e) => e.eventType);
        for (const esperado of ['CUENTA_CREADA', 'ORGANIZATION_CREATED', 'MEMBERSHIP_CREATED']) {
          expect(delTenant, `la auditoria del centro registra ${esperado}`).toContain(esperado);
        }
        // Lo de identidad NO esta en la del tenant: es de la persona, no del centro.
        expect(delTenant).not.toContain('RESET_COMPLETADO');
      } finally {
        await fundadora.cerrar();
      }

      // --- Auditoria de identidad (lectura de la tabla: ver la cabecera) ----------------------
      const hechos = hechosDeIdentidad(email);
      for (const esperado of [
        'CUENTA_ACTIVADA',
        'LOGIN_EXITOSO',
        'RESET_SOLICITADO',
        'RESET_COMPLETADO',
        'LOGIN_FALLIDO',
      ]) {
        expect(hechos, `la auditoria de identidad registra ${esperado}`).toContain(esperado);
      }
      // El orden es parte del hecho: el reset se completa despues de pedirse, y el login que
      // falla con la contrasena vieja es posterior al cambio.
      expect(hechos.indexOf('RESET_COMPLETADO')).toBeGreaterThan(
        hechos.indexOf('RESET_SOLICITADO'),
      );
      expect(hechos.lastIndexOf('LOGIN_FALLIDO')).toBeGreaterThan(
        hechos.indexOf('RESET_COMPLETADO'),
      );
    } finally {
      await http.dispose();
    }
  });

  test.describe('Permisos y auditoria de un centro', () => {
    // Un solo centro para los dos tests: montarlo son dos altas self-service, y el cupo es de 4
    // por minuto. En serie para que el `beforeAll` corra una vez y no una por worker.
    test.describe.configure({ mode: 'serial' });

    let montaje: Awaited<ReturnType<typeof centroConProfesional>>;

    test.beforeAll(async () => {
      test.setTimeout(180_000);
      montaje = await centroConProfesional();
    });

    test.afterAll(async () => {
      await montaje?.admin.cerrar();
    });

    test('acceso denegado: la pantalla redirige, el backend responde 403 y la auditoria del centro lo registra', async ({
      page,
    }) => {
      const {
        admin,
        emailAdmin,
        emailProfesional,
        centro,
        organizationId,
        organizacionPropia,
        vinculo,
      } = montaje;
      let profesionalEnElCentro: ApiAkine | undefined;
      try {
        // --- Pantalla: elige el centro en el selector y la auditoria la manda a /sin-permiso ----
        await ingresarCon(page, emailProfesional, PASSWORD);
        await expect(page).toHaveURL(/\/seleccionar-contexto/);
        await page.getByRole('button', { name: centro }).click();
        await expect(page).not.toHaveURL(/\/seleccionar-contexto/);

        await page.goto('/organizacion/auditoria');
        await expect(page).toHaveURL(/\/sin-permiso/);
        await expect(
          page.getByRole('heading', { name: 'No tenes permiso para esta pantalla' }),
        ).toBeVisible();
        await expect(page.getByText(centro, { exact: true })).toBeVisible();

        // La consola de plataforma tampoco: tener un centro propio no es ser de la plataforma.
        await page.goto('/plataforma');
        await expect(page).toHaveURL(/\/sin-permiso/);

        // --- Backend: el guard es UX; por URL directa el rechazo lo da la API ------------------
        profesionalEnElCentro = await ApiAkine.como(emailProfesional, { organizationId });
        const desde = new Date(Date.now() - 60 * 60_000).toISOString();
        const hasta = new Date(Date.now() + 60 * 60_000).toISOString();
        await esperarProblema(
          await profesionalEnElCentro.pedir(
            'GET',
            `/api/v1/organizations/${organizationId}/audit-events?from=${desde}&to=${hasta}`,
          ),
          403,
          'https://akine.app/problems/forbidden',
        );
        // Una cuenta comun no da de alta organizaciones. Va con su Idempotency-Key para que el
        // rechazo sea el de permiso y no el 400 por falta de la cabecera.
        await esperarProblema(
          await profesionalEnElCentro.pedir(
            'POST',
            '/api/v1/organizations',
            { name: `Intento ${nonce()}`, planCode: 'BASICO' },
            { 'Idempotency-Key': randomUUID() },
          ),
          403,
          'https://akine.app/problems/forbidden',
        );

        // La auditoria de un tenant ajeno no existe para quien no es miembro: 404, no 403, para no
        // confirmar que ese tenant existe.
        await esperarProblema(
          await admin.pedir(
            'GET',
            `/api/v1/organizations/${organizacionPropia}/audit-events?from=${desde}&to=${hasta}`,
          ),
          404,
          'https://akine.app/problems/not-found',
        );

        // --- Auditoria del centro, por la API: el rechazo quedo registrado ---------------------
        await expect(async () => {
          const pagina = await admin.exigir<{
            content: { eventType: string; details?: Record<string, string> }[];
          }>(
            'GET',
            `/api/v1/organizations/${organizationId}/audit-events?actorAccountId=${vinculo.accountId}&size=100`,
          );
          const rechazos = pagina.content.filter((e) => e.eventType === 'PERMISSION_DENIED');
          expect(
            rechazos.map((e) => e.details?.['permissionCode']),
            'PERMISSION_DENIED por auditoria:read de la profesional',
          ).toContain('auditoria:read');
        }).toPass({ timeout: 10_000 });

        const historial = await admin.exigir<{ content: { eventType: string }[] }>(
          'GET',
          `/api/v1/organizations/${organizationId}/audit-events?entityType=Membership&entityId=${vinculo.id}`,
        );
        expect(historial.content.map((e) => e.eventType)).toContain('MEMBERSHIP_CREATED');

        // --- Y la pantalla de Auditoria se lo muestra al ORG_ADMIN -----------------------------
        await page.context().clearCookies();
        await ingresarCon(page, emailAdmin, PASSWORD);
        await expect(page).toHaveURL(/\/organizacion/);
        await page.goto('/organizacion/auditoria');
        await page.getByLabel('Actividad de una persona').check();
        await page.getByLabel('Numero de cuenta').fill(String(vinculo.accountId));
        await page.getByRole('button', { name: 'Buscar' }).click();
        const tabla = page.getByRole('region', { name: 'Hechos auditados de la organizacion' });
        await expect(tabla.getByRole('cell', { name: 'PERMISSION_DENIED' }).first()).toBeVisible();
      } finally {
        await profesionalEnElCentro?.cerrar();
      }
    });

    test('la auditoria se lee solo desde el contexto de esa organizacion', async () => {
      const { emailProfesional, organizationId, organizacionPropia } = montaje;
      const enLoPropio = await ApiAkine.como(emailProfesional, {
        organizationId: organizacionPropia,
      });
      const enElCentro = await ApiAkine.como(emailProfesional, { organizationId });
      try {
        const desde = new Date(Date.now() - 60 * 60_000).toISOString();
        const hasta = new Date(Date.now() + 60 * 60_000).toISOString();
        const ruta = `/api/v1/organizations/${organizacionPropia}/audit-events?from=${desde}&to=${hasta}`;

        // Control: desde su propio consultorio, donde es ORG_ADMIN, la lee.
        await enLoPropio.exigir('GET', ruta);
        // Desde el centro, la misma organizacion se trata como ajena en la ficha...
        await esperarProblema(
          await enElCentro.pedir('GET', `/api/v1/organizations/${organizacionPropia}`),
          404,
          'https://akine.app/problems/not-found',
        );
        // ...y en la auditoria tendria que pasar lo mismo.
        await esperarProblema(
          await enElCentro.pedir('GET', ruta),
          404,
          'https://akine.app/problems/not-found',
        );
      } finally {
        await enLoPropio.cerrar();
        await enElCentro.cerrar();
      }
    });
  });

  test('la administracion de plataforma da de alta una organizacion, y el slug repetido es un 409 tipado', async () => {
    const http = await fabricaDeRequest.newContext({ baseURL: API });
    try {
      const token = await ingresarComoPlataforma(http);
      const slug = `e2e-a6-${nonce()}`;
      const alta = (clave: string) =>
        http.post('/api/v1/organizations', {
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json, application/problem+json',
            'Idempotency-Key': clave,
          },
          data: { name: `Organizacion E2E ${slug}`, slug, planCode: 'BASICO' },
        });

      const creada = await alta(randomUUID());
      expect(creada.status(), await creada.text()).toBe(201);
      const organizacion = (await creada.json()) as { id: number; slug: string };
      expect(organizacion.slug).toBe(slug);
      expect(creada.headers()['location']).toContain(`/api/v1/organizations/${organizacion.id}`);

      // El alta administrativa crea SIEMPRE su primera sede (ver el contrato): sin ella el tenant
      // no ofreceria ningun contexto de trabajo.
      expect(
        Number(sql(`SELECT COUNT(*) FROM consultorio WHERE organization_id=${organizacion.id}`)),
        'la organizacion nace con su primer consultorio',
      ).toBe(1);

      await esperarProblema(
        await alta(randomUUID()),
        409,
        'https://akine.app/problems/organization-slug-taken',
      );
    } finally {
      await http.dispose();
    }
  });
});

/**
 * Un centro con su ORG_ADMIN y una profesional vinculada que ademas tiene su consultorio propio:
 * dos contextos, y en el del centro sin `auditoria:read`. Dos altas self-service, con cupo.
 */
async function centroConProfesional() {
  const sufijo = nonce();
  const emailAdmin = emailUnico('a6.admin');
  const emailProfesional = emailUnico('a6.profesional');
  const centro = `Centro Permisos ${sufijo}`;

  await cuentaActiva({ email: emailAdmin, organizationName: centro });
  await cuentaActiva({
    email: emailProfesional,
    organizationName: `Consultorio Propio ${sufijo}`,
    firstName: 'Pablo',
  });

  const admin = await ApiAkine.como(emailAdmin);
  const [{ organizationId, consultorioId }] = await admin.exigir<
    { organizationId: number; consultorioId: number }[]
  >('GET', '/api/v1/me/contexts');
  const { membershipId } = await admin.exigir<{ membershipId: number }>(
    'POST',
    '/api/v1/memberships',
    {
      email: emailProfesional,
      roleCode: 'PROFESIONAL',
      consultorioId,
      reason: 'Profesional sintetica de los E2E de A-6',
    },
  );
  // El alta devuelve solo el id del vinculo; la cuenta —que es por lo que filtra la auditoria por
  // actor— sale del vinculo mismo.
  const { accountId } = await admin.exigir<{ accountId: number }>(
    'GET',
    `/api/v1/organizations/${organizationId}/memberships/${membershipId}`,
  );
  const vinculo = { id: membershipId, accountId };

  const profesional = await ApiAkine.como(emailProfesional, { organizationId });
  try {
    const contextos = await profesional.exigir<{ organizationId: number }[]>(
      'GET',
      '/api/v1/me/contexts',
    );
    const organizacionPropia = contextos.find(
      (c) => c.organizationId !== organizationId,
    )!.organizationId;
    return {
      admin,
      emailAdmin,
      emailProfesional,
      centro,
      organizationId,
      organizacionPropia,
      vinculo,
    };
  } finally {
    await profesional.cerrar();
  }
}
