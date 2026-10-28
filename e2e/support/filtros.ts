import { Locator, Page, expect } from '@playwright/test';

/**
 * Despliega los filtros avanzados de un listado (`app-filtros`, UX-01) si estan plegados.
 *
 * <p>Desde la regla de filtros (plan §3.4) los selectores "Mostrar", estado, tipo, etc. viven
 * detras del boton del embudo. Un E2E que los usa los abre antes; si ya estan abiertos (llego con
 * filtros activos) no hace nada.
 */
export async function abrirFiltros(contenedor: Page | Locator): Promise<void> {
  const boton = contenedor.getByRole('button', { name: /^Filtros/ }).first();
  if ((await boton.getAttribute('aria-expanded')) === 'false') {
    await boton.click();
  }
}

/**
 * Abre el menu "⋯" de una fila (`app-acciones-de-fila`) para llegar a sus acciones secundarias,
 * que estan en el DOM pero escondidas hasta abrirlo. `fila` es el locator de la fila (o de
 * cualquier contenedor que tenga un solo menu).
 *
 * <p>Vuelve recien cuando la pantalla dibujo el menu abierto. `getAttribute` lee el DOM sin
 * esperar, y el click actualiza `aria-expanded` en la deteccion de cambios SIGUIENTE: dos
 * llamadas seguidas (flujo-padron, 22/10/2026) podian leer el `false` de antes del primer
 * click, y el segundo click cerraba el menu que el primero habia abierto. El test se colgaba
 * despues, esperando una accion escondida.
 */
export async function abrirAcciones(fila: Locator): Promise<void> {
  const boton = fila.getByRole('button', { name: /^Más acciones de / });
  if ((await boton.getAttribute('aria-expanded')) !== 'true') {
    await boton.click();
  }
  // Corto: si la fila se redibujo cerrada (una busqueda que recarga), que falle rapido y el
  // `toPass` del llamador vuelva a abrirla, en vez de gastar los 10 s del `expect`.
  await expect(boton).toHaveAttribute('aria-expanded', 'true', { timeout: 2_000 });
}
