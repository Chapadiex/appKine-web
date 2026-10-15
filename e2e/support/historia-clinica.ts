import { randomUUID } from 'node:crypto';

import { APIRequestContext, Page, expect } from '@playwright/test';

import {
  PASSWORD,
  activarCuentaPorSql,
  emailUnico,
  idDeOrganizacion,
  idDePrimerConsultorio,
  ingresarPorPantalla,
  nonce,
  registrarPorApi,
} from './akine';
import { navegar } from './agenda-real';
import { ApiAkine, servicioAgendable } from './sembrado';

/**
 * Sembrado de una Historia Clinica contra el backend real (D-a, D-b, D-c, D-e).
 *
 * <p>Dos cuentas, como en un centro de verdad:
 *
 * <ul>
 *   <li><b>La administradora</b> (ORG_ADMIN) da de alta el centro, la persona y la oferta. NO tiene
 *       `hc:read`: la matriz §2 no se lo da por defecto, y desde G-5 tampoco se le puede otorgar
 *       por grant (`permiso-no-otorgable-al-rol`). Es la cuenta del camino "acceso denegado".
 *   <li><b>La profesional</b> (PROFESIONAL) tiene `hc:read`/`hc:write` por su rol. Es miembro del
 *       centro y de su propio consultorio, asi que entra eligiendo contexto. No tiene relacion
 *       asistencial con la persona —no hay turnos ni sesiones—, asi que todo acceso clinico le pide
 *       motivo: es el camino que las pantallas tienen que resolver.
 * </ul>
 *
 * <p>Todo pasa por la API salvo activar las cuentas (el canje del correo), que va por SQL como en
 * el resto de los specs de `support/akine.ts`.
 */

/** Un PNG de 1x1. Alcanza para que el backend lo clasifique como imagen por sus bytes. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export const MOTIVO_DE_ACCESO = 'Revision de prueba E2E';
export const TEXTO_DE_LA_ENTRADA = 'Dolor lumbar de tres semanas, sin irradiacion.';

export interface HistoriaSembrada {
  /** La profesional: con ella se entra a las pantallas clinicas. */
  readonly email: string;
  /** La administradora: sin `hc:read`. */
  readonly emailAdmin: string;
  readonly organizacion: string;
  readonly organizationId: number;
  readonly consultorioId: number;
  /** Membership PROFESIONAL de la profesional en el centro. */
  readonly membershipId: number;
  readonly nombreProfesional: string;
  readonly personaId: number;
  readonly historiaClinicaId: number;
  readonly entradaId: number;
  readonly nombreCompleto: string;
  /** Oferta de la sede con la profesional habilitada: motiva casos y se planifica. */
  readonly oferta: { readonly id: number; readonly nombre: string };
}

export async function sembrarHistoria(request: APIRequestContext): Promise<HistoriaSembrada> {
  const sufijo = nonce();
  const emailAdmin = emailUnico('qa.hc.admin');
  const email = emailUnico('qa.hc.prof');
  const organizacion = `Centro HC ${sufijo}`;
  const apellidoProfesional = `Kinesiologa${sufijo}`;
  await registrarPorApi(request, { email: emailAdmin, organizationName: organizacion });
  await registrarPorApi(request, {
    email,
    firstName: 'Paula',
    lastName: apellidoProfesional,
    organizationName: `Consultorio propio ${sufijo}`,
  });
  activarCuentaPorSql(emailAdmin);
  activarCuentaPorSql(email);

  const organizationId = idDeOrganizacion(organizacion);
  const consultorioId = idDePrimerConsultorio(organizationId);

  const admin = await ApiAkine.como(emailAdmin, { organizationId });
  try {
    const { membershipId } = await admin.exigir<{ membershipId: number }>(
      'POST',
      '/api/v1/memberships',
      {
        email,
        roleCode: 'PROFESIONAL',
        consultorioId,
        reason: 'Profesional sintetica de los E2E clinicos',
      },
    );

    const oferta = await crearOfertaClinica(admin, consultorioId, membershipId);
    const persona = await crearPaciente(request, emailAdmin, organizationId, consultorioId);

    const profesional = await ApiAkine.como(email, { organizationId });
    try {
      const conMotivo = { 'X-Justificacion-Acceso': MOTIVO_DE_ACCESO };
      const historia = await exigirClinico<{ id: number }>(
        profesional,
        'PUT',
        `/api/v1/historias-clinicas/por-persona/${persona.id}`,
        undefined,
        conMotivo,
      );
      const entrada = await exigirClinico<{ id: number }>(
        profesional,
        'POST',
        `/api/v1/historias-clinicas/${historia.id}/entradas`,
        { tipo: 'EVOLUCION', cuerpo: TEXTO_DE_LA_ENTRADA },
        { ...conMotivo, 'Idempotency-Key': randomUUID() },
      );
      await subirAdjunto(request, email, organizationId, consultorioId, historia.id);

      return {
        email,
        emailAdmin,
        organizacion,
        organizationId,
        consultorioId,
        membershipId,
        nombreProfesional: apellidoProfesional,
        personaId: persona.id,
        historiaClinicaId: historia.id,
        entradaId: entrada.id,
        nombreCompleto: `${persona.apellido}, ${persona.nombre}`,
        oferta,
      };
    } finally {
      await profesional.cerrar();
    }
  } finally {
    await admin.cerrar();
  }
}

async function exigirClinico<T>(
  api: ApiAkine,
  metodo: 'GET' | 'POST' | 'PUT',
  ruta: string,
  cuerpo: unknown,
  cabeceras: Record<string, string>,
): Promise<T> {
  const respuesta = await api.pedir(metodo, ruta, cuerpo, cabeceras);
  expect(respuesta.ok(), `${metodo} ${ruta}: ${respuesta.status()} ${await respuesta.text()}`).toBe(
    true,
  );
  return (await respuesta.json()) as T;
}

async function crearOfertaClinica(
  admin: ApiAkine,
  consultorioId: number,
  membershipId: number,
): Promise<{ id: number; nombre: string }> {
  const servicioId = await servicioAgendable(admin);
  const nombre = `Kinesiologia HC ${nonce()}`;
  const oferta = await admin.exigir<{ id: number; version: number }>(
    'POST',
    `/api/v1/consultorios/${consultorioId}/ofertas`,
    {
      servicioId,
      nombreComercial: nombre,
      capacidad: 1,
      duracionMinutos: 45,
      requiereProfesional: true,
      requiereEspacio: false,
    },
  );
  await admin.exigir(
    'PUT',
    `/api/v1/consultorios/${consultorioId}/ofertas/${oferta.id}/habilitaciones/profesionales`,
    { expectedVersion: oferta.version, ids: [membershipId] },
  );
  return { id: oferta.id, nombre };
}

/** Persona con perfil de paciente, dada de alta por la administradora (es tarea de mostrador). */
async function crearPaciente(
  request: APIRequestContext,
  emailAdmin: string,
  organizationId: number,
  consultorioId: number,
): Promise<{ id: number; nombre: string; apellido: string }> {
  const auth = {
    Authorization: `Bearer ${await tokenDe(request, emailAdmin, organizationId, consultorioId)}`,
  };
  const documento = String(Math.floor(20_000_000 + Math.random() * 30_000_000));
  const persona = await request.post('/api/v1/personas', {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: {
      nombre: 'Lucia',
      apellido: `Prueba${nonce()}`,
      tipoDocumento: 'DNI',
      numeroDocumento: documento,
    },
  });
  expect(persona.status(), `alta de persona: ${await persona.text()}`).toBe(201);
  const creada = (await persona.json()) as { id: number; nombre: string; apellido: string };

  const perfil = await request.post(`/api/v1/personas/${creada.id}/perfil-paciente`, {
    headers: { ...auth, 'Idempotency-Key': randomUUID() },
    data: {},
  });
  expect([200, 201], `perfil de paciente: ${await perfil.text()}`).toContain(perfil.status());
  return creada;
}

/** El multipart no pasa por `ApiAkine` (que manda JSON): se sube con el `request` del test. */
async function subirAdjunto(
  request: APIRequestContext,
  email: string,
  organizationId: number,
  consultorioId: number,
  historiaClinicaId: number,
): Promise<void> {
  const token = await tokenDe(request, email, organizationId, consultorioId);
  const adjunto = await request.post(
    `/api/v1/historias-clinicas/${historiaClinicaId}/adjuntos?categoria=IMAGEN&titulo=Placa`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Justificacion-Acceso': MOTIVO_DE_ACCESO,
        'Idempotency-Key': randomUUID(),
      },
      multipart: { archivo: { name: 'placa.png', mimeType: 'image/png', buffer: PNG_1X1 } },
    },
  );
  expect(adjunto.status(), `adjunto clinico: ${await adjunto.text()}`).toBe(201);
}

async function tokenDe(
  request: APIRequestContext,
  email: string,
  organizationId: number,
  consultorioId: number,
): Promise<string> {
  const login = await request.post('/api/v1/auth/login', { data: { email, password: PASSWORD } });
  expect(login.status(), `login de ${email}`).toBe(200);
  const preContexto = ((await login.json()) as { accessToken: string }).accessToken;
  const contexto = await request.post('/api/v1/auth/context', {
    headers: { Authorization: `Bearer ${preContexto}` },
    data: { organizationId, consultorioId },
  });
  expect(contexto.status(), `seleccion de contexto: ${await contexto.text()}`).toBe(200);
  return ((await contexto.json()) as { accessToken: string }).accessToken;
}

/**
 * Ingresa por pantalla como la profesional y elige el centro: tiene dos contextos (el centro y su
 * consultorio propio), asi que el selector se muestra.
 */
export async function entrarConContexto(page: Page, sembrada: HistoriaSembrada): Promise<void> {
  await ingresarPorPantalla(page, sembrada.email);
  await expect(page).toHaveURL(/\/seleccionar-contexto/, { timeout: 15_000 });
  await page
    .getByRole('button', {
      name: new RegExp(sembrada.organizacion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    })
    .click();
  await expect(page).not.toHaveURL(/\/(auth|seleccionar-contexto)/, { timeout: 15_000 });
}

/** Ingresa por pantalla como la administradora: un solo contexto, el selector elige solo. */
export async function entrarComoAdministradora(
  page: Page,
  sembrada: HistoriaSembrada,
): Promise<void> {
  await ingresarPorPantalla(page, sembrada.emailAdmin);
  await page.waitForURL((url) => !/\/(auth\/ingresar|seleccionar-contexto)/.test(url.pathname));
}

/** Entra como la profesional, abre la historia y declara el motivo. */
export async function abrirHistoriaConMotivo(
  page: Page,
  sembrada: HistoriaSembrada,
): Promise<void> {
  await entrarConContexto(page, sembrada);
  await navegar(page, `/historia-clinica/personas/${sembrada.personaId}`);
  await page.getByRole('textbox', { name: 'Motivo del acceso' }).fill(MOTIVO_DE_ACCESO);
  await page.getByRole('button', { name: 'Ver la historia clinica' }).click();
  await expect(page.getByRole('heading', { name: sembrada.nombreCompleto })).toBeVisible();
}
