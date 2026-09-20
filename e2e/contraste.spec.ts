import { expect, test } from '@playwright/test';

import { auditarContraste, instalarApiDeContraste } from './support/contraste';
import {
  FECHA,
  NOMBRE_OFERTA,
  agendaDe,
  diaConSlots,
  diaVacio,
  instalarApiDeTurnos,
  masDias,
  ok,
} from './support/agenda-simulada';

/**
 * Auditoria de CONTRASTE DE COLOR contra un navegador real (WCAG 1.4.3, nivel AA).
 *
 * <h2>Que hueco cierra</h2>
 *
 * <p>El `CLAUDE.md` del workspace declaraba, textual: <i>"el contraste de color no esta
 * verificado en ninguna parte"</i>. Las 40 auditorias de axe del repositorio corren bajo jsdom,
 * que no calcula layout, y ahi `color-contrast` termina siempre en `incomplete` —"no pude
 * comprobarlo"—. Una suite que solo mira `violations` queda en verde <b>sin haber medido nada</b>.
 * Este archivo es el unico lugar del repositorio donde el contraste se mide de verdad.
 *
 * <h2>Criterio de seleccion de pantallas</h2>
 *
 * <p>Los colores del producto viven en <b>una sola capa de tokens</b> (`src/design-system.css`):
 * fuera de su `:root` no queda un `#rrggbb` en todo `src/`. Entonces auditar las 50 pantallas
 * seria medir los mismos pares una y otra vez. Lo que se cubre son los <b>patrones visuales</b>,
 * y en particular los estados que en la practica son los que fallan y los que menos se auditan:
 *
 * <ul>
 *   <li><b>Formulario en reposo y en error</b> — `.campo__error` y el borde `aria-invalid`
 *       son texto y borde de peligro sobre la superficie de la pagina.</li>
 *   <li><b>Boton deshabilitado</b> — `--color-deshabilitado` es el token que mas facil se va
 *       abajo de 4.5:1, porque su razon de ser es "apagado".</li>
 *   <li><b>Estado de error de pagina</b> — `.estado--error`, el rojo mas grande del sistema.</li>
 *   <li><b>Estado vacio</b> — `.estado--vacio` usa el gris atenuado, que es texto igual.</li>
 *   <li><b>Tabla con filas dadas de baja</b> — la fila atenuada cambia el FONDO bajo un texto
 *       que no cambia: es el par que ninguna revision por componente ve.</li>
 *   <li><b>Las tres marcas de estado</b> — exito, aviso y peligro, cada una texto de un tono
 *       sobre fondo del mismo tono. Tres pares que solo existen juntos en esa tabla.</li>
 *   <li><b>La barra de marca</b> — superficie oscura con texto claro, y el item actual sobre
 *       una segunda superficie. Es la unica zona del producto donde el esquema se invierte, y
 *       en modo oscuro NO se aclara: son dos pares distintos por tema.</li>
 *   <li><b>La grilla de agenda</b> — el slot completo se dibuja marcado en vez de esconderse, y
 *       el dia vacio muestra su motivo en texto atenuado.</li>
 * </ul>
 *
 * <h2>Lo que esta auditoria NO cubre, y hay que decirlo</h2>
 *
 * <ul>
 *   <li><b>WCAG 1.4.11 (contraste de lo que no es texto, 3:1).</b> `color-contrast` mide texto y
 *       nada mas. El borde de un `input`, el anillo de foco y el borde de una pastilla quedan
 *       fuera: axe no tiene regla automatica para eso. Los valores estan elegidos para cumplirlo
 *       —`--color-borde-control` da 3,54:1 en claro— pero <b>nadie los verifica</b>.</li>
 *   <li><b>La franja donde el degrade del desborde de tabla si pinta.</b> Ver la declaracion del
 *       escenario de espacios.</li>
 *   <li><b>Los estados `:hover` y `:focus-visible`.</b> Se auditan los estados en reposo; un
 *       token de hover que rompa contraste no lo agarra nada de esto.</li>
 * </ul>
 *
 * <h2>Los dos temas</h2>
 *
 * <p>El sistema tiene modo claro y oscuro, y el oscuro <b>no es una inversion simetrica</b>: el
 * boton de accion cambia de azul casi negro con texto blanco a azul claro con texto oscuro,
 * mientras la cabecera se queda oscura. Un par que pasa en claro puede fallar en oscuro y al
 * reves. Por eso cada escenario corre dos veces, una por proyecto de Playwright
 * (`contraste-claro` y `contraste-oscuro`), que fijan `colorScheme` y con el
 * `prefers-color-scheme` que la hoja de tokens consulta.
 *
 * <h2>Como se corre y por que no necesita backend</h2>
 *
 * <pre>npm run a11y:contraste</pre>
 *
 * <p>Playwright levanta el frontend solo y la API se simula con `route.fulfill`, igual que los
 * dos E2E de agenda. Para medir un contraste no hace falta un backend real: hace falta que la
 * pantalla se pinte. Eso lo vuelve ejecutable en CI y en una maquina sin Docker, que es la
 * condicion por la que esta etapa se pudo hacer mientras todo lo demas esperaba.
 */

test.describe('Contraste de color', () => {
  test.describe('sin sesion', () => {
    test('el login en reposo, con sus enlaces y su boton de accion', async ({ page }) => {
      await instalarApiDeContraste(page);
      await page.goto('/auth/ingresar');
      await expect(page.getByRole('heading', { name: 'Iniciar sesion', level: 1 })).toBeVisible();

      await auditarContraste(page, 'login en reposo');
    });

    /**
     * El estado que mas falla y menos se audita. Se llega por la pantalla: enviar el formulario
     * vacio marca los dos campos con `aria-invalid` y pinta sus dos `.campo__error`.
     */
    test('el login con los dos campos en error', async ({ page }) => {
      await instalarApiDeContraste(page);
      await page.goto('/auth/ingresar');
      await page.getByRole('button', { name: 'Iniciar sesion' }).click();

      await expect(page.getByText('Escribi un email valido.')).toBeVisible();
      await expect(page.getByText('Escribi tu contrasena.')).toBeVisible();

      await auditarContraste(page, 'login con los dos campos en error');
    });

    /**
     * El boton deshabilitado y el mensaje de error del servidor, en la misma pantalla.
     *
     * <p>La respuesta se retiene a proposito: mientras el envio esta en vuelo el boton queda
     * `:disabled`, que es el unico momento en que `--color-deshabilitado` se pinta de verdad.
     * Se audita ahi, se libera la respuesta y se audita otra vez con el `.estado--error`.
     */
    test('el boton deshabilitado mientras envia, y despues el error del servidor', async ({
      page,
    }) => {
      await instalarApiDeContraste(page);

      let liberar: () => void = () => undefined;
      const enVuelo = new Promise<void>((resolver) => {
        liberar = resolver;
      });

      await page.route('**/api/v1/auth/login', async (ruta) => {
        await enVuelo;
        await ruta.fulfill({
          status: 401,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'https://akine.app/problems/invalid-credentials',
            title: 'invalid-credentials',
            status: 401,
            detail: 'El email o la contrasena no son correctos.',
          }),
        });
      });

      await page.goto('/auth/ingresar');
      await page.locator('form').getByLabel('Email').fill('ana.prueba@ejemplo.test');
      await page.locator('form').getByLabel('Contrasena').fill('una-contrasena-larga-y-unica-2026');
      await page.getByRole('button', { name: 'Iniciar sesion' }).click();

      const boton = page.getByRole('button', { name: 'Iniciar sesion' });
      await expect(boton).toBeDisabled();
      await auditarContraste(page, 'login con el boton deshabilitado mientras envia', {
        queAxeNoMide: [
          {
            selector: '.boton:disabled',
            porque:
              'axe descarta los controles deshabilitados antes de medirlos, porque WCAG 1.4.3 ' +
              'exime a los componentes de interfaz inactivos. Se comprobo rompiendo ' +
              '`--color-deshabilitado` a proposito: el gate no lo agarraba. AKINE igual lo ' +
              'exige -un boton apagado ilegible no dice "bloqueado", dice "aca no hay nada"-, ' +
              'asi que lo mide el arnes con la misma aritmetica y el mismo minimo.',
          },
        ],
      });

      liberar();
      await expect(page.getByRole('alert')).toBeVisible();
      await auditarContraste(page, 'login con el error del servidor');
    });

    test('la pantalla de ruta inexistente', async ({ page }) => {
      await instalarApiDeContraste(page);
      await page.goto('/esta-ruta-no-existe');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      await auditarContraste(page, 'ruta inexistente');
    });
  });

  test.describe('con sesion y contexto', () => {
    /**
     * La pantalla mas densa del sistema de diseno: tabla desplazable, filas dadas de baja, las
     * tres marcas de estado, pastillas, botones chicos de accion, paginacion, y encima la barra
     * de navegacion con su item actual. Un solo escenario mide una docena larga de pares.
     */
    test('los espacios de la sede, con los dados de baja a la vista', async ({ page }) => {
      await instalarApiDeContraste(page);
      await page.goto('/espacios');

      await page.getByLabel('Mostrar').selectOption('TODOS');
      await expect(page.getByText('Sala grupal chica')).toBeVisible();

      await auditarContraste(page, 'espacios de la sede con los dados de baja a la vista', {
        degrade: {
          selector: '.tabla-scroll',
          porque:
            'La sombra que anuncia el desborde horizontal esta hecha con cuatro degrades en el ' +
            '`background` del contenedor desplazable (`src/design-system.css`). axe no puede ' +
            'aplanar un `background-image`, asi que devuelve `incomplete` para CADA celda que ' +
            'no traiga fondo propio -las de `.fila--revocada` si se miden, porque la fila pinta ' +
            'el suyo-. El arnes las mide contra el primer fondo opaco de la cadena en vez de ' +
            'darlas por buenas. Afecta a las 19 plantillas que usan `.tabla-scroll`.',
        },
      });
    });

    test('el padron sin ninguna fila', async ({ page }) => {
      const api = await instalarApiDeContraste(page);
      api.padron = 'vacio';

      await page.goto('/pacientes');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      await auditarContraste(page, 'padron con el estado vacio');
    });

    test('el padron con un error del servidor', async ({ page }) => {
      const api = await instalarApiDeContraste(page);
      api.padron = 'error';

      await page.goto('/pacientes');
      await expect(page.getByRole('alert')).toBeVisible();

      await auditarContraste(page, 'padron con un error del servidor');
    });

    /**
     * La grilla de agenda con las dos cosas que la etapa 05.01 decidio <b>mostrar</b> en vez de
     * esconder: el slot sin cupo, dibujado marcado, y el dia sin turnos con su motivo.
     */
    test('la grilla de agenda con un slot completo y un dia sin turnos', async ({ page }) => {
      const api = await instalarApiDeTurnos(page);
      api.agenda = () =>
        ok(
          agendaDe([
            diaConSlots(FECHA, { completoElPrimero: true }),
            diaVacio(masDias(FECHA, 1), 'SIN_HORARIO'),
          ]),
        );

      await page.goto('/agenda');
      await page.getByLabel('Oferta', { exact: true }).selectOption({ label: NOMBRE_OFERTA });
      await expect(page.getByRole('heading', { name: NOMBRE_OFERTA, level: 2 })).toBeVisible();

      await auditarContraste(page, 'grilla de agenda con un slot completo y un dia sin turnos');
    });
  });
});
