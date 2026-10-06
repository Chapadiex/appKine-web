import { randomUUID } from 'node:crypto';

import { APIRequestContext, Page, expect } from '@playwright/test';

import {
  PASSWORD,
  activarCuentaPorSql,
  emailUnico,
  idDeCuenta,
  idDeOrganizacion,
  idDePrimerConsultorio,
  ingresarPorPantalla,
  nonce,
  registrarPorApi,
  sql,
} from './akine';

/**
 * Sembrado de una Historia Clinica contra el backend real (D-a).
 *
 * <p>Todo pasa por la API salvo dos cosas que no tienen camino soportado desde un test: activar la
 * cuenta (el canje del correo) y nada mas. El permiso clinico se otorga por la API de grants, igual
 * que lo haria un administrador: `hc:read`/`hc:write` no estan en la base del ORG_ADMIN, la matriz
 * §2 los deja como "no por defecto".
 *
 * <p>La cuenta no tiene relacion asistencial con la persona —no hay turnos ni sesiones—, asi que
 * todo acceso clinico exige motivo. Es justamente el camino que la pantalla tiene que resolver.
 */

/** Un PNG de 1x1. Alcanza para que el backend lo clasifique como imagen por sus bytes. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export const MOTIVO_DE_ACCESO = 'Revision de prueba E2E';
export const TEXTO_DE_LA_ENTRADA = 'Dolor lumbar de tres semanas, sin irradiacion.';

export interface HistoriaSembrada {
  readonly email: string;
  readonly organizacion: string;
  readonly personaId: number;
  readonly entradaId: number;
  readonly nombreCompleto: string;
}

export async function sembrarHistoria(request: APIRequestContext): Promise<HistoriaSembrada> {
  const email = emailUnico('qa.hc');
  const organizacion = `Centro HC ${nonce()}`;
  await registrarPorApi(request, { email, organizationName: organizacion });
  activarCuentaPorSql(email);

  const organizationId = idDeOrganizacion(organizacion);
  const consultorioId = idDePrimerConsultorio(organizationId);
  const accountId = idDeCuenta(email);

  const login = await request.post('/api/v1/auth/login', { data: { email, password: PASSWORD } });
  expect(login.status(), 'login por API').toBe(200);
  const tokenDeLogin = ((await login.json()) as { accessToken: string }).accessToken;

  const token = await elegirContexto(request, tokenDeLogin, organizationId, consultorioId);
  const auth = { Authorization: `Bearer ${token}` };

  const membershipId = Number(
    sql(
      `SELECT id FROM membership WHERE account_id=${accountId} AND organization_id=${organizationId} ` +
        `ORDER BY id LIMIT 1`,
    ),
  );
  await Promise.all(
    ['hc:read', 'hc:write'].map(async (permissionCode) => {
      const grant = await request.post(
        `/api/v1/organizations/${organizationId}/memberships/${membershipId}/grants`,
        { headers: auth, data: { permissionCode, reason: 'Profesional del centro (E2E)' } },
      );
      expect([200, 201], `grant de ${permissionCode}`).toContain(grant.status());
    }),
  );
  // El permiso se resuelve contra la base, pero el token se emite con el contexto: se pide otro.
  const tokenClinico = await elegirContexto(request, tokenDeLogin, organizationId, consultorioId);
  const clinico = {
    Authorization: `Bearer ${tokenClinico}`,
    'X-Justificacion-Acceso': MOTIVO_DE_ACCESO,
  };

  const documento = String(Math.floor(20_000_000 + Math.random() * 30_000_000));
  const persona = await request.post('/api/v1/personas', {
    headers: { ...clinico, 'Idempotency-Key': randomUUID() },
    data: {
      nombre: 'Lucia',
      apellido: `Prueba${nonce()}`,
      tipoDocumento: 'DNI',
      numeroDocumento: documento,
    },
  });
  expect(persona.status(), `alta de persona: ${await persona.text()}`).toBe(201);
  const personaCreada = (await persona.json()) as { id: number; nombre: string; apellido: string };

  const perfil = await request.post(`/api/v1/personas/${personaCreada.id}/perfil-paciente`, {
    headers: { ...clinico, 'Idempotency-Key': randomUUID() },
    data: {},
  });
  expect([200, 201], `perfil de paciente: ${await perfil.text()}`).toContain(perfil.status());

  const historia = await request.put(`/api/v1/historias-clinicas/por-persona/${personaCreada.id}`, {
    headers: clinico,
  });
  expect(historia.status(), `apertura de la HC: ${await historia.text()}`).toBe(200);
  const historiaClinicaId = ((await historia.json()) as { id: number }).id;

  const entrada = await request.post(`/api/v1/historias-clinicas/${historiaClinicaId}/entradas`, {
    headers: { ...clinico, 'Idempotency-Key': randomUUID() },
    data: { tipo: 'EVOLUCION', cuerpo: TEXTO_DE_LA_ENTRADA },
  });
  expect(entrada.status(), `entrada clinica: ${await entrada.text()}`).toBe(201);
  const entradaId = ((await entrada.json()) as { id: number }).id;

  const adjunto = await request.post(
    `/api/v1/historias-clinicas/${historiaClinicaId}/adjuntos?categoria=IMAGEN&titulo=Placa`,
    {
      headers: { ...clinico, 'Idempotency-Key': randomUUID() },
      multipart: { archivo: { name: 'placa.png', mimeType: 'image/png', buffer: PNG_1X1 } },
    },
  );
  expect(adjunto.status(), `adjunto clinico: ${await adjunto.text()}`).toBe(201);

  return {
    email,
    organizacion,
    personaId: personaCreada.id,
    entradaId,
    nombreCompleto: `${personaCreada.apellido}, ${personaCreada.nombre}`,
  };
}

async function elegirContexto(
  request: APIRequestContext,
  token: string,
  organizationId: number,
  consultorioId: number,
): Promise<string> {
  const contexto = await request.post('/api/v1/auth/context', {
    headers: { Authorization: `Bearer ${token}` },
    data: { organizationId, consultorioId },
  });
  expect(contexto.status(), `seleccion de contexto: ${await contexto.text()}`).toBe(200);
  return ((await contexto.json()) as { accessToken: string }).accessToken;
}

/**
 * Ingresa por pantalla y queda con contexto. La cuenta sembrada tiene UN solo contexto, y el
 * selector elige solo cuando hay uno (`context-selector-page`): se espera ese resultado, sin carrera.
 */
export async function entrarConContexto(page: Page, sembrada: HistoriaSembrada): Promise<void> {
  await ingresarPorPantalla(page, sembrada.email);
  await page.waitForURL((url) => !/\/(auth\/ingresar|seleccionar-contexto)/.test(url.pathname));
}
