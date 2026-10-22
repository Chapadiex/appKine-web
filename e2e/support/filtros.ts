import { Locator, Page } from '@playwright/test';

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
