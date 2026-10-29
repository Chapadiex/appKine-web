import type { Page } from '@playwright/test';

/**
 * Cierra los avisos globales (UX-12) que esten a la vista.
 *
 * <p>Los avisos viven arriba a la derecha, por encima de la pantalla, y pasar el puntero por uno
 * pausa su cierre automatico. Un clic sobre un boton que un aviso tapa deja el puntero encima del
 * aviso: el aviso ya no se va y el clic reintenta hasta el timeout del test. Despues de leer un
 * aviso, si lo que sigue es un clic en esa zona, se cierra.
 */
export async function cerrarAvisos(page: Page): Promise<void> {
  const cerrar = page
    .getByRole('region', { name: 'Notificaciones', exact: true })
    .getByRole('button', { name: 'Cerrar el aviso' });
  // Acotado: un aviso puede vencer entre el conteo y el clic, y el clic no tiene que esperarlo.
  for (let i = 0; i < 5 && (await cerrar.count()) > 0; i++) {
    await cerrar
      .first()
      .click({ timeout: 2_000 })
      .catch(() => undefined);
  }
}
