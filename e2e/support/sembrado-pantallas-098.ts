import { randomUUID } from 'node:crypto';

import { Page, expect, request as fabricaDeRequest } from '@playwright/test';

import { conReintentoPor429, emailUnico, ingresarPorPantalla, nonce, PASSWORD } from './akine';
import {
  API,
  ApiAkine,
  Centro,
  Financiador,
  Obligacion,
  Oferta,
  Persona,
  activarPorMailpit,
  cerrarSesionDelTurno,
  crearConvenio,
  crearFinanciador,
  crearOferta,
  crearPersona,
  darCobertura,
  diaDeTrabajo,
  fechaLocal,
  obligacionesDe,
  practicaGlobal,
  reservarElPrimeroLibre,
  sumarDias,
} from './sembrado';

/**
 * Sembrado de los E2E de las pantallas que entraron con web #74 (contrato 0.98.0): exportar una
 * presentacion a CSV, cobertura elegida al reservar, consumos a revisar por fila y los datos
 * administrativos de la historia clinica en el Paciente 360.
 *
 * <p>Vive aparte de `sembrado.ts` y de `sembrado-configuracion.ts` para no pisarse con otros PR que
 * agregan al final de esos archivos. Usa el MISMO centro de `agenda-setup`.
 */

/**
 * Bloques de dias de estos specs, desde HOY en la zona de la sede. Siguen a los de
 * `DIAS_CONFIGURACION` (`sembrado-configuracion.ts`), que llegan hasta el 124.
 */
export const DIAS_PANTALLAS_098 = {
  presentacionCsv: 130,
  coberturaAlReservar: 133,
  consumosARevisar: 136,
} as const;

/** Cabecera de la justificacion de acceso clinico (DP-03): la sonda asistencial no existe todavia. */
export const JUSTIFICACION = {
  'X-Justificacion-Acceso': 'Sembrado de los E2E: la profesional atiende a la persona',
};

/** Hace un pedido con cabeceras propias y exige 2xx; devuelve el cuerpo parseado. */
export async function exigirCon<T>(
  api: ApiAkine,
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE',
  ruta: string,
  cuerpo: unknown,
  cabeceras: Record<string, string>,
): Promise<T> {
  const respuesta = await api.pedir(metodo, ruta, cuerpo, cabeceras);
  const texto = await respuesta.text();
  expect(respuesta.ok(), `${metodo} ${ruta} respondio ${respuesta.status()}: ${texto}`).toBe(true);
  return (texto === '' ? undefined : JSON.parse(texto)) as T;
}

/** Oferta que admite obra social, con `KIN_SESION` como practica principal. */
export interface OfertaConPractica {
  readonly oferta: Oferta;
  readonly practicaId: number;
}

export async function ofertaConPractica(
  api: ApiAkine,
  centro: Centro,
  total: number,
): Promise<OfertaConPractica> {
  const practicaId = await practicaGlobal(api, 'KIN_SESION');
  const oferta = await crearOferta(api, centro, {
    extra: { admiteObraSocial: true, precioBase: total, moneda: 'ARS' },
  });
  await api.exigir(
    'PUT',
    `/api/v1/consultorios/${centro.consultorioId}/ofertas/${oferta.id}/practicas`,
    { practicaIds: [practicaId], practicaPrincipalId: practicaId, expectedVersion: oferta.version },
  );
  return { oferta, practicaId };
}

/** Lo que deja {@link sembrarPrestacionFinanciada}: la persona, su cobertura y las dos deudas. */
export interface PrestacionFinanciada {
  readonly financiador: Financiador;
  readonly persona: Persona;
  readonly coberturaId: number;
  readonly practicaId: number;
  readonly sesionId: number;
  /** La autorizacion cargada antes del cierre, si se pidio. */
  readonly autorizacionId?: number;
  readonly coseguro: Obligacion & { readonly version: number };
}

/**
 * Financiador con plan, convenio de la sede con arancel para `KIN_SESION`, persona con cobertura
 * FINANCIADA, y un turno en el bloque `desdeHoy` cuya sesion cierra la profesional: el devengado deja
 * la deuda del financiador y el coseguro del paciente. Con `autorizacion` carga ademas una
 * autorizacion APROBADA de esa practica ANTES del cierre, que el cierre consume.
 */
export async function sembrarPrestacionFinanciada(
  api: ApiAkine,
  profesional: ApiAkine,
  centro: Centro,
  desdeHoy: number,
  importes: { total: number; financiador: number; coseguro: number },
  autorizacion?: { numero: string; cantidad: number },
): Promise<PrestacionFinanciada> {
  const desde = sumarDias(fechaLocal(centro.timezone), -30);
  const { oferta, practicaId } = await ofertaConPractica(api, centro, importes.total);
  const financiador = await crearFinanciador(api, desde);
  const convenio = await crearConvenio(api, centro, financiador, desde);
  await api.exigir(
    'POST',
    `/api/v1/consultorios/${centro.consultorioId}/convenios/${convenio.id}/aranceles`,
    {
      practicaId,
      importeTotal: importes.total,
      importeFinanciador: importes.financiador,
      coseguro: importes.coseguro,
      vigenciaDesde: desde,
    },
  );
  const persona = await crearPersona(api);
  const coberturaId = await darCobertura(api, persona, financiador, desde);
  let autorizacionId: number | undefined;
  if (autorizacion !== undefined) {
    const creada = await api.exigir<{ id: number }>(
      'POST',
      `/api/v1/personas/${persona.id}/autorizaciones`,
      {
        coberturaId,
        practicaId,
        numero: autorizacion.numero,
        estadoInicial: 'APROBADA',
        cantidadAutorizada: autorizacion.cantidad,
        vigenciaDesde: desde,
        vigenciaHasta: sumarDias(desde, 240),
      },
    );
    autorizacionId = creada.id;
  }

  const { slots } = await diaDeTrabajo(api, centro, oferta.id, desdeHoy);
  const turno = await reservarElPrimeroLibre(api, centro, oferta.id, persona.id, slots);
  const sesionId = await cerrarSesionDelTurno(profesional, centro, turno.id);

  const [coseguro] = await obligacionesDe(api, centro, persona.id);
  expect(coseguro?.concepto, 'el cierre devengo el coseguro del paciente').toBe('COSEGURO');
  return {
    financiador,
    persona,
    coberturaId,
    practicaId,
    sesionId,
    autorizacionId,
    coseguro: coseguro as Obligacion & { version: number },
  };
}

/**
 * Cuenta nueva (self-service, activada por Mailpit) vinculada a la sede del centro con `rol`.
 * Respeta el cupo de altas de la corrida (`conReintentoPor429` pide turno en
 * `esperarCupoDeRegistro`).
 */
export async function colaboradoraActiva(
  api: ApiAkine,
  centro: Centro,
  rol: 'ADMINISTRATIVO',
): Promise<{ readonly email: string; readonly membershipId: number }> {
  const email = emailUnico('e2e.p098.administrativa');
  const http = await fabricaDeRequest.newContext({ baseURL: API });
  try {
    const alta = await conReintentoPor429(() =>
      http.post('/api/v1/auth/register', {
        headers: { 'Idempotency-Key': randomUUID() },
        data: {
          email,
          password: PASSWORD,
          firstName: 'Ada',
          lastName: `Mostrador ${nonce()}`,
          organizationName: `Consultorio de la administrativa ${nonce()}`,
        },
      }),
    );
    expect(alta.status(), `alta de ${email}: ${await alta.text()}`).toBe(202);
    await activarPorMailpit(http, email);
  } finally {
    await http.dispose();
  }
  const { membershipId } = await api.exigir<{ membershipId: number }>(
    'POST',
    '/api/v1/memberships',
    {
      email,
      roleCode: rol,
      consultorioId: centro.consultorioId,
      reason: 'Administrativa sintetica de los E2E del Paciente 360',
    },
  );
  return { email, membershipId };
}

/**
 * Ingresa por pantalla con una cuenta que tiene DOS contextos (su consultorio propio y el centro) y
 * elige el del centro en el selector.
 */
export async function ingresarAlCentro(page: Page, email: string, centro: Centro): Promise<void> {
  await ingresarPorPantalla(page, email);
  await expect(page).toHaveURL(/\/seleccionar-contexto/, { timeout: 15_000 });
  await page
    .getByRole('button', {
      name: new RegExp(centro.nombreCentro.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    })
    .click();
  await expect(page).not.toHaveURL(/\/(auth|seleccionar-contexto)/, { timeout: 15_000 });
}
