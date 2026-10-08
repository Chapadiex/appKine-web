import { Page, expect, test } from '@playwright/test';

import { NOMBRE_OFERTA, instalarApiDeTurnos } from './support/agenda-simulada';
import { instalarApiDeContraste } from './support/contraste';
import {
  FECHA,
  PERSONA_ID,
  auditarBordes,
  auditarHover,
  instalarApiDelRecorrido,
  recorrerConTeclado,
} from './support/no-textual';

/**
 * Contraste NO textual, foco visible, hover y recorrido por teclado (WCAG 1.4.11, 2.1.1, 2.1.2,
 * 2.4.3 y 2.4.7, nivel AA) — AKINE-G-7.
 *
 * <p>Complementa a `contraste.spec.ts`, que mide texto con axe. Lo que esta auditoria mide no lo
 * mide ninguna regla automatica de axe: el contorno de los controles y el anillo de foco contra
 * su fondo (3:1), el texto de cada boton y enlace EN HOVER (4,5:1), y que el Tab recorra la
 * pantalla en el orden del documento, empezando por el skip link y sin trampas. El detalle de la
 * aritmetica esta en `support/no-textual.ts`.
 *
 * <p><b>Pantallas:</b> las del circuito diario de recepcion —login, selector de contexto,
 * agenda, recepcion del dia, cobros y caja—. Los colores viven en una sola capa de tokens, asi
 * que lo que se cubre son los patrones: formulario, barra de marca, tabla con acciones, panel
 * desplegado y grilla de agenda, cada uno en los dos temas (proyectos `contraste-claro` y
 * `contraste-oscuro`).
 *
 * <p><b>Diálogos:</b> AKINE no tiene modales; las confirmaciones son paneles en linea que se
 * despliegan bajo la fila. El criterio de WCAG 2.4.3 para ellos es el mismo: al abrir, el foco
 * va al panel; al cerrar, vuelve al control que lo abrio. Eso tambien se prueba aca.
 *
 * <p>No necesita backend: la API se simula con `route.fulfill`.
 */

/** La primera carga de un chunk lazy en el servidor de desarrollo, con seis workers, pasa los 5 s. */
const LLEGADA = 20_000;

async function auditarPantalla(page: Page, donde: string): Promise<void> {
  await auditarBordes(page, donde);
  await recorrerConTeclado(page, donde);
  await auditarHover(page, donde);
}

test.describe('Contraste no textual, foco y teclado', () => {
  // Pasar el mouse por cada boton y enlace de una pantalla densa lleva mas que el default de 30 s.
  test.describe.configure({ timeout: 90_000 });

  test('login', async ({ page }) => {
    await instalarApiDeContraste(page);
    await page.goto('/auth/ingresar');
    await expect(page.getByRole('heading', { name: 'Iniciar sesion', level: 1 })).toBeVisible({
      timeout: LLEGADA,
    });

    await auditarPantalla(page, 'login');
  });

  test('selector de contexto con dos sedes', async ({ page }) => {
    await instalarApiDelRecorrido(page, { conContexto: false });
    await page.goto('/seleccionar-contexto');
    await expect(page.getByText('Sede Norte')).toBeVisible({ timeout: LLEGADA });

    await auditarPantalla(page, 'selector de contexto');
  });

  test('agenda con una oferta elegida', async ({ page }) => {
    await instalarApiDeTurnos(page);
    await page.goto('/agenda');
    await page.getByLabel('Oferta', { exact: true }).selectOption({ label: NOMBRE_OFERTA });
    await expect(page.getByRole('heading', { name: NOMBRE_OFERTA, level: 2 })).toBeVisible({
      timeout: LLEGADA,
    });

    await auditarPantalla(page, 'agenda');
  });

  test('recepcion del dia', async ({ page }) => {
    await instalarApiDelRecorrido(page);
    await page.goto(`/agenda/recepcion?fecha=${FECHA}`);
    await expect(page.getByText('Ibarra, Dario')).toBeVisible({ timeout: LLEGADA });

    await auditarPantalla(page, 'recepcion del dia');
  });

  test('cobros de una persona', async ({ page }) => {
    await instalarApiDelRecorrido(page);
    await page.goto(`/pacientes/${PERSONA_ID}/cuenta-corriente/cobros`);
    await expect(page.getByRole('button', { name: 'Ver el comprobante' })).toBeVisible({
      timeout: LLEGADA,
    });

    await auditarPantalla(page, 'cobros');
  });

  test('caja diaria abierta', async ({ page }) => {
    await instalarApiDelRecorrido(page);
    await page.goto('/caja');
    await expect(page.getByText('Cambio para el dia')).toBeVisible({ timeout: LLEGADA });

    await auditarPantalla(page, 'caja');
  });

  test.describe('paneles en linea: el foco va al panel y vuelve al cerrarlo', () => {
    test('recepcion: Atender como Particular y Cancelar', async ({ page }) => {
      await instalarApiDelRecorrido(page);
      await page.goto(`/agenda/recepcion?fecha=${FECHA}`);

      const abrir = page.getByRole('button', { name: 'Atender como Particular' });
      await abrir.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('Motivo (obligatorio)')).toBeFocused();

      await page.getByRole('button', { name: 'Cancelar' }).focus();
      await page.keyboard.press('Enter');
      await expect(abrir).toBeFocused();
    });

    test('caja: Revertir y Cancelar', async ({ page }) => {
      await instalarApiDelRecorrido(page);
      await page.goto('/caja');

      await page.getByRole('button', { name: 'Revertir' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('Motivo de la reversion')).toBeFocused();

      await page.getByRole('button', { name: 'Cancelar' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: 'Revertir' })).toBeFocused();
    });

    test('cobros: Ver el comprobante y Cerrar el comprobante', async ({ page }) => {
      await instalarApiDelRecorrido(page);
      await page.goto(`/pacientes/${PERSONA_ID}/cuenta-corriente/cobros`);

      await page.getByRole('button', { name: 'Ver el comprobante' }).focus();
      await page.keyboard.press('Enter');
      const cerrar = page.getByRole('button', { name: 'Cerrar el comprobante' });
      await expect(cerrar).toBeFocused();

      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: 'Ver el comprobante' })).toBeFocused();
    });
  });
});
