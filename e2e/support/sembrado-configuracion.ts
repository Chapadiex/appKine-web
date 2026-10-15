import { randomUUID } from 'node:crypto';

import { Browser, Page, expect, request as fabricaDeRequest } from '@playwright/test';

import {
  conReintentoPor429,
  emailUnico,
  esperarCupoDeRegistro,
  ingresarPorPantalla,
  nonce,
  PASSWORD,
} from './akine';
import {
  API,
  ApiAkine,
  Centro,
  EMAIL_PLATAFORMA,
  Oferta,
  crearOferta,
  deAUnLogin,
  esperaDel429,
  fechaLocal,
  ingresarComoPlataforma,
  sumarDias,
} from './sembrado';

/**
 * Sembrado de los E2E de configuracion: espacios, catalogo, horarios, servicios y padron.
 *
 * <p>Vive aparte de `sembrado.ts` para no pisarse con otros PR que agregan al final de ese archivo.
 * Usa el MISMO centro de `agenda-setup`: un centro propio serian dos altas mas contra el limite de
 * 4 por minuto.
 *
 * <h2>Lo que estos specs tocan del centro compartido, y por que no molesta</h2>
 *
 * <ul>
 *   <li>El profesional del centro atiende las 24 horas los siete dias. Los specs que reservan con
 *       el usan bloques de dias propios ({@link DIAS_CONFIGURACION}), lejos de los de `DIAS`.</li>
 *   <li>Horarios NO edita al profesional compartido ni el horario general de la sede: un cierre o
 *       un bloque nuevo sobre el le cambiaria la agenda a los demas specs. Vincula a una SEGUNDA
 *       profesional, sin horario, y todo lo carga sobre ella.</li>
 *   <li>Los feriados son del calendario nacional y se leen, no se tocan.</li>
 * </ul>
 */

/**
 * Bloques de dias de estos specs, desde HOY en la zona de la sede. Siguen a los de `DIAS` de
 * `sembrado.ts`, que llegan hasta el 95.
 */
export const DIAS_CONFIGURACION = {
  espacioConTurno: 110,
  servicioSinCascada: 116,
  desvinculacionConTurno: 122,
} as const;

/** Profesional propia de un spec: vinculo PROFESIONAL en la sede del centro, sin horario. */
export interface Profesional {
  readonly membershipId: number;
  readonly nombre: string;
}

/**
 * Da de alta una cuenta nueva (self-service) y la vincula como PROFESIONAL a la sede del centro.
 *
 * <p>No se activa: la profesional nunca ingresa, solo atiende en la agenda. El alta respeta el cupo
 * compartido de registros de la corrida (`esperarCupoDeRegistro`).
 */
export async function vincularProfesional(api: ApiAkine, centro: Centro): Promise<Profesional> {
  const sufijo = nonce();
  const email = emailUnico('e2e.config.profesional');
  const nombre = `Paula Horarios ${sufijo}`;
  const http = await fabricaDeRequest.newContext({ baseURL: API });
  try {
    await esperarCupoDeRegistro();
    const alta = await conReintentoPor429(() =>
      http.post('/api/v1/auth/register', {
        headers: { 'Idempotency-Key': randomUUID() },
        data: {
          email,
          password: PASSWORD,
          firstName: 'Paula',
          lastName: `Horarios ${sufijo}`,
          organizationName: `Consultorio Horarios ${sufijo}`,
        },
      }),
    );
    expect(alta.status(), `alta de ${email}: ${await alta.text()}`).toBe(202);
  } finally {
    await http.dispose();
  }

  const { membershipId } = await api.exigir<{ membershipId: number }>(
    'POST',
    '/api/v1/memberships',
    {
      email,
      roleCode: 'PROFESIONAL',
      consultorioId: centro.consultorioId,
      reason: 'Profesional sintetica de los E2E de horarios',
    },
  );
  return { membershipId, nombre };
}

/** Oferta habilitada SOLO para `profesional` (y no para el profesional compartido del centro). */
export function ofertaDe(
  api: ApiAkine,
  centro: Centro,
  profesional: Profesional,
  opciones: Parameters<typeof crearOferta>[2] = {},
): Promise<Oferta> {
  return crearOferta(api, { ...centro, profesional }, opciones);
}

export interface Feriado {
  readonly fecha: string;
  readonly nombre: string;
}

/**
 * Un feriado nacional F que la sede cierra, con F+7 y F+14 habiles (no feriados), entre
 * `desdeHoy` y `hastaHoy` dias. Los tres caen el mismo dia de la semana, asi que un solo bloque
 * semanal los cubre. `null` si la sede no cierra por feriado o el calendario no trae ninguno.
 */
export async function feriadoConSemanasHabiles(
  api: ApiAkine,
  centro: Centro,
  desdeHoy: number,
  hastaHoy: number,
): Promise<Feriado | null> {
  const desde = fechaLocal(centro.timezone, desdeHoy);
  const calendario = await api.exigir<{
    cierraPorFeriado: boolean;
    feriados?: { fecha: string; nombre: string }[];
  }>(
    'GET',
    `/api/v1/consultorios/${centro.consultorioId}/calendario?desde=${desde}&hasta=${fechaLocal(centro.timezone, hastaHoy + 15)}`,
  );
  if (!calendario.cierraPorFeriado) {
    return null;
  }
  const feriados = calendario.feriados ?? [];
  const esFeriado = new Set(feriados.map((f) => f.fecha));
  const limite = fechaLocal(centro.timezone, hastaHoy);
  return (
    feriados.find(
      (f) =>
        f.fecha <= limite &&
        !esFeriado.has(sumarDias(f.fecha, 7)) &&
        !esFeriado.has(sumarDias(f.fecha, 14)),
    ) ?? null
  );
}

/** Dia de la semana ISO (1 = lunes ... 7 = domingo) de una fecha `YYYY-MM-DD`. */
export function diaIso(fecha: string): number {
  const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay();
  return dia === 0 ? 7 : dia;
}

/**
 * Asegura que la cuenta de plataforma de la corrida pueda ingresar (activandola por Mailpit si
 * hace falta, ver `ingresarComoPlataforma`). Devuelve el motivo por el que NO se puede, para que el
 * test se saltee diciendolo, o `null` si se puede.
 */
export async function plataformaDisponible(): Promise<string | null> {
  const http = await fabricaDeRequest.newContext({ baseURL: API });
  try {
    await ingresarComoPlataforma(http);
    return null;
  } catch (error) {
    return (
      `no hay cuenta de plataforma utilizable (${EMAIL_PLATAFORMA}): arranca el backend con ` +
      `AKINE_BOOTSTRAP_ADMIN_EMAIL=${EMAIL_PLATAFORMA}. ${String(error).slice(0, 200)}`
    );
  } finally {
    await http.dispose();
  }
}

/**
 * Abre un navegador aparte con la sesion de la administradora de plataforma, ingresando por
 * pantalla. No tiene contexto de centro: opera con el token `pre_context`, asi que el login la
 * deja en el selector de contexto y desde ahi navega a donde haga falta.
 */
export async function paginaDePlataforma(browser: Browser): Promise<Page> {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  // Igual que `ingresar` del centro: un 429 del login no es el producto fallando sino el limite de
  // 30 por minuto y por IP que comparten login y refresh de toda la corrida. Se espera lo que pide
  // `Retry-After` FUERA del cerrojo y se vuelve a ingresar, hasta tres intentos. Antes este helper
  // esperaba 15 s a que la URL saliera de /auth/ y fallaba en `flujo-catalogo` sin decir por que.
  for (let intento = 1; ; intento++) {
    const espera = await deAUnLogin(async () => {
      const login = page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/auth/login'),
      );
      await ingresarPorPantalla(page, EMAIL_PLATAFORMA);
      const respuesta = await login;
      if (respuesta.status() === 429 && intento < 3) {
        return esperaDel429(respuesta);
      }
      expect(
        respuesta.status(),
        `login de plataforma por pantalla: ${await respuesta.text()}`,
      ).toBe(200);
      await expect(page).not.toHaveURL(/\/auth\//, { timeout: 15_000 });
      return 0;
    });
    if (espera === 0) {
      return page;
    }
    await page.waitForTimeout(espera * 1_000);
  }
}
