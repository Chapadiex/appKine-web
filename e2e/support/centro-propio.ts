import { Locator, Page, expect } from '@playwright/test';

import { ApiAkine, Centro, altaDeCentro, comoProfesional } from './sembrado';

/**
 * Centro PROPIO de un spec, para los E2E de las pantallas de mas riesgo (dinero, permisos,
 * concurrencia) contra el backend real.
 *
 * <p><b>Por que no el centro compartido de `agenda-setup`.</b> Estos specs abren y cierran la caja,
 * arman y anulan lotes, otorgan y quitan permisos: estado de la SEDE, no de un turno. Sobre el
 * centro compartido le cambiarian el estado a los `flujo-*` que corren al lado (la caja es una por
 * sede), y sumar miembros a un centro BASICO lo lleva al tope del plan: `plan-limit-exceeded` ya
 * rompio el CI asi. Un centro propio son dos altas mas contra el cupo de `esperarCupoDeRegistro`.
 *
 * <p>Viven en el proyecto `chromium` (no se llaman `flujo-*`) para no depender del sembrado de
 * `agenda-setup`. Cada archivo siembra su centro una vez en `beforeAll`: un reintento del CI
 * reinicia el worker y siembra otro, que es justamente lo que lo vuelve independiente del intento
 * anterior.
 */
export interface CentroPropio {
  readonly centro: Centro;
  /** La administradora (ORG_ADMIN), con el contexto del centro elegido. */
  readonly api: ApiAkine;
  /** La profesional del centro (PROFESIONAL), con el contexto del centro elegido. */
  readonly profesional: ApiAkine;
}

export async function sembrarCentroPropio(etiqueta: string): Promise<CentroPropio> {
  const centro = await altaDeCentro(etiqueta, etiqueta);
  const api = await ApiAkine.como(centro.emailAdmin);
  const profesional = await comoProfesional(centro);
  return { centro, api, profesional };
}

export async function cerrarCentroPropio(propio: CentroPropio | undefined): Promise<void> {
  await propio?.api.cerrar();
  await propio?.profesional.cerrar();
}

/** El valor de una fila `<dt>`/`<dd>` de un resumen. */
export function dato(contenedor: Page | Locator, termino: string): Locator {
  return contenedor
    .locator('dt', { hasText: new RegExp(`^${termino}$`) })
    .locator('xpath=following-sibling::dd[1]');
}

/** Fila de la tabla de movimientos de la caja abierta por su concepto. */
export function movimientoDeCaja(page: Page, concepto: string | RegExp): Locator {
  return page
    .getByRole('region', { name: 'Movimientos de esta jornada' })
    .getByRole('row')
    .filter({ hasText: concepto });
}

export { expect };
