import { expect, test as setup } from '@playwright/test';

import { sembrarCentro } from './support/sembrado';

/**
 * Siembra el centro que comparten los E2E de agenda, ciclo y recepcion (proyecto `agenda-setup`).
 *
 * <p>Corre una vez por corrida, antes del proyecto `agenda`, que lo declara en `dependencies`.
 * Si falla —backend caido, Mailpit sin el correo, catalogo sin servicios— no corre ningun spec de
 * agenda, y el reporte dice por que en un solo lugar.
 */
setup('sembrar el centro de agenda por la API real', async () => {
  setup.setTimeout(180_000);
  const centro = await sembrarCentro();
  expect(centro.consultorioId).toBeGreaterThan(0);
});
