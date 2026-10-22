import { expect, test } from '@playwright/test';

import {
  CLASE,
  PERSONA_CON_PASES,
  abrirBorradorDeHonorarios,
  auditarContraste,
  instalarApiDeContraste,
} from './support/contraste';
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
import { instalarApiDp43 } from './support/pantallas-dp43';
import { abrirFiltros } from './support/filtros';

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
 *       nada mas. El borde de los controles y el anillo de foco los mide, desde AKINE-G-7,
 *       `contraste-no-textual.spec.ts`. El borde de una pastilla sigue sin medir: no es un
 *       control, y su estado se dice tambien con texto.</li>
 *   <li><b>Los estados `:hover` y `:focus-visible`.</b> Aca se auditan los estados en reposo; el
 *       hover y el foco por teclado los mide `contraste-no-textual.spec.ts`.</li>
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
      await expect(page.getByRole('heading', { name: 'Iniciar sesión', level: 1 })).toBeVisible();

      await auditarContraste(page, 'login en reposo');
    });

    /**
     * El estado que mas falla y menos se audita. Se llega por la pantalla: enviar el formulario
     * vacio marca los dos campos con `aria-invalid` y pinta sus dos `.campo__error`.
     */
    test('el login con los dos campos en error', async ({ page }) => {
      await instalarApiDeContraste(page);
      await page.goto('/auth/ingresar');
      await page.getByRole('button', { name: 'Ingresar' }).click();

      await expect(page.getByText('Escribí un correo válido.')).toBeVisible();
      await expect(page.getByText('Escribí tu contraseña.')).toBeVisible();

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
      await page.locator('form').getByLabel('Correo electrónico').fill('ana.prueba@ejemplo.test');
      await page.locator('form').getByLabel('Contraseña').fill('una-contrasena-larga-y-unica-2026');
      await page.getByRole('button', { name: 'Ingresar' }).click();

      const boton = page.getByRole('button', { name: 'Ingresar' });
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

      await abrirFiltros(page);
      await page.getByLabel('Mostrar').selectOption('TODOS');
      await expect(page.getByText('Sala grupal chica')).toBeVisible();

      await auditarContraste(page, 'espacios de la sede con los dados de baja a la vista');
    });

    /**
     * La tabla DESBORDADA y desplazada a la mitad: el unico estado en que el indicador de
     * desborde se pinta de los dos lados a la vez.
     *
     * <p>Hasta el 12/10/2026 el indicador era una sombra en el `background` del contenedor, y en
     * la franja donde pintaba el texto suave caia a ~4,16:1 sin que nada lo midiera: axe no aplana
     * un `background-image`. Ahora es el borde lateral del contenedor, afuera del area donde se
     * recorta el contenido. Esto prueba tres cosas: que con contenido escondido de los dos lados
     * los DOS bordes se pintan, que llegan a 3:1 contra la pagina (WCAG 1.4.11, es un indicador
     * grafico), y que el contenedor no pinta NADA debajo del texto: sin `background-image` y con el
     * indicador en el borde, afuera de la caja donde se recorta el contenido. Que axe mida cada
     * celda sin un `incomplete` lo prueba el escenario de espacios de arriba, que antes necesitaba
     * la medicion a mano y ya no.
     *
     * <p>Aca NO se corre axe, y es a proposito: con la tabla desplazada, las columnas que quedan
     * afuera del contenedor son `incomplete` por estar fuera de la vista, no por su color. Es la
     * misma razon por la que axe no puede auditar un carrusel a mitad de recorrido.
     */
    test('una tabla desbordada, desplazada a la mitad, con el indicador a los dos lados', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 480, height: 900 });
      await instalarApiDeContraste(page);
      await page.goto('/espacios');
      await abrirFiltros(page);
      await page.getByLabel('Mostrar').selectOption('TODOS');
      await expect(page.getByText('Sala grupal chica')).toBeVisible();

      const contenedor = page.locator('.tabla-scroll').first();
      const bordes = () =>
        contenedor.evaluate((el) => {
          const estilo = getComputedStyle(el);
          return {
            inicio: estilo.borderLeftColor,
            fin: estilo.borderRightColor,
            desborda: el.scrollWidth > el.clientWidth,
          };
        });

      const alPrincipio = await bordes();
      expect(alPrincipio.desborda, 'a 480 px la tabla de espacios tiene que desbordar').toBe(true);
      expect(
        esTransparente(alPrincipio.inicio),
        'al principio no hay nada escondido a la izquierda',
      ).toBe(true);
      expect(
        esTransparente(alPrincipio.fin),
        'al principio hay columnas escondidas a la derecha',
      ).toBe(false);

      await contenedor.evaluate((el) => {
        el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
      });
      await expect.poll(async () => esTransparente((await bordes()).inicio)).toBe(false);
      const enElMedio = await bordes();
      expect(esTransparente(enElMedio.fin)).toBe(false);

      const fondo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(
        contraste(enElMedio.inicio, fondo),
        `el indicador de desborde (${enElMedio.inicio}) contra la pagina (${fondo})`,
      ).toBeGreaterThanOrEqual(3);

      const pintura = await contenedor.evaluate((el) => ({
        fondo: getComputedStyle(el).backgroundImage,
        bordeIzquierdo: el.clientLeft,
      }));
      expect(pintura.fondo, 'el contenedor no pinta ningun degrade debajo del texto').toBe('none');
      expect(
        pintura.bordeIzquierdo,
        'el indicador ocupa el borde, afuera de la caja donde se recorta el contenido',
      ).toBeGreaterThan(0);
    });

    /** Clases grupales (F9): la semana con una clase cancelada y el detalle con lista de espera. */
    test('la semana de clases con una cancelada', async ({ page }) => {
      await instalarApiDeContraste(page);
      await page.goto('/clases?semana=2026-10-20');
      await expect(page.getByText('Yoga suave', { exact: true })).toBeVisible();

      await auditarContraste(page, 'semana de clases con una cancelada');
    });

    test('el detalle de una clase llena con lista de espera', async ({ page }) => {
      await instalarApiDeContraste(page);
      await page.goto(`/clases/${CLASE.id}`);
      await expect(page.getByText('Sosa, Eva — posicion 1')).toBeVisible();

      await auditarContraste(page, 'detalle de una clase llena con lista de espera');
    });

    /** Honorarios por clase (DP-38): la grilla de tarifas de la oferta, con una dada de baja. */
    test('las tarifas de honorario de una oferta, con una dada de baja', async ({ page }) => {
      await instalarApiDeContraste(page);
      await page.goto(`/servicios/ofertas/${CLASE.ofertaId}/honorarios`);
      await expect(page.getByText('Rige hoy')).toBeVisible();

      await auditarContraste(page, 'tarifas de honorario de una oferta');
    });

    test('el borrador de una liquidacion de honorarios con dos servicios y excluidas', async ({
      page,
    }) => {
      await instalarApiDeContraste(page);
      await page.goto('/egresos/honorarios');
      await abrirBorradorDeHonorarios(page);

      await auditarContraste(page, 'borrador de una liquidacion de honorarios');
    });

    /** Atencion clinica de la clase (AKINE-08.05), con las derivaciones de una participante. */
    test('la atencion clinica de una clase con las derivaciones abiertas', async ({ page }) => {
      await instalarApiDeContraste(page);
      await page.goto(`/atencion/clases/${CLASE.id}`);
      await expect(page.getByText('Atención cerrada', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: /Derivaciones de Perez, Ana/ }).click();
      await expect(
        page.getByText('Motivo de la reversión: Derivada al caso equivocado'),
      ).toBeVisible();

      await auditarContraste(page, 'atencion clinica de una clase con derivaciones');
    });

    /**
     * Derivar a una participante a un caso (AKINE-08.04): el veredicto, los casos activos y el
     * error de no haber elegido ninguno.
     */
    test('derivar a una participante con dos casos activos y sin elegir', async ({ page }) => {
      await instalarApiDeContraste(page);
      await page.goto(`/atencion/clases/${CLASE.id}`);
      await page.getByRole('button', { name: /Derivar a un caso a Perez, Ana/ }).click();
      const tarjeta = page.getByRole('region', { name: 'Derivar a Perez, Ana a un caso clínico' });
      await expect(tarjeta.getByText('Con 2 casos activos')).toBeVisible();
      await tarjeta.getByRole('button', { name: 'Derivar al caso' }).click();
      await expect(tarjeta.getByText('Elegí a qué caso se deriva.')).toBeVisible();

      await auditarContraste(page, 'derivar a una participante sin elegir caso');
    });

    /**
     * Hardening de F9 (AKINE-09.02): los estados de las pantallas de clases que faltaban. El alta
     * con cada campo en error, la lista del dia, la asistencia con el resultado de un lote —el
     * guardado, el credito del pase y el fallo con su causa, en la region `aria-live`— y el lote
     * de atencion clinica con un participante que no se pudo abrir.
     */
    test('el alta de una clase con los campos en error', async ({ page }) => {
      await instalarApiDeContraste(page);
      await page.goto('/clases/nueva');
      await page.getByLabel('Oferta grupal').selectOption({ label: 'Pilates reformer' });
      await page.getByLabel('Fecha', { exact: true }).fill('');
      await page.getByLabel('Cupo').fill('0');
      await page.getByRole('button', { name: 'Programar clase' }).click();
      await expect(page.getByText('Elegí la fecha de la clase.')).toBeVisible();
      await expect(page.getByText('El cupo es de 1 en adelante.')).toBeVisible();
      // El foco quedo en el primer campo en error (WCAG 3.3.1).
      await expect(page.getByLabel('Fecha', { exact: true })).toBeFocused();

      await auditarContraste(page, 'alta de una clase con los campos en error');
    });

    test('las clases del dia para tomar asistencia, con una cancelada', async ({ page }) => {
      await instalarApiDeContraste(page);
      await page.goto('/asistencia?fecha=2026-10-20');
      await expect(page.getByRole('cell', { name: 'Yoga suave', exact: true })).toBeVisible();

      await auditarContraste(page, 'clases del dia con una cancelada');
    });

    test('la asistencia en curso con el resultado de un lote parcial', async ({ page }) => {
      await instalarApiDeContraste(page);
      await page.goto(`/asistencia/${CLASE.id}`);
      await page.getByRole('button', { name: 'Marcar presentes a los sin marcar' }).click();
      await page
        .getByRole('group', { name: 'Asistencia de Gomez, Luis' })
        .getByLabel('Ausente', { exact: true })
        .check();
      await page.getByLabel('Motivo de la correccion').fill('Se fue a los diez minutos');
      await page.getByRole('button', { name: /Guardar asistencia/ }).click();

      const resultado = page.getByRole('region', { name: 'Resultado' });
      await expect(resultado.getByText('Gomez, Luis')).toBeVisible();
      await expect(resultado).toBeFocused();
      await expect(page.locator('[aria-live="polite"]').getByText('Se guardaron 1')).toBeVisible();

      await auditarContraste(page, 'asistencia en curso con el resultado de un lote parcial');
    });

    test('la atencion clinica de una clase con el lote que no pudo abrir una', async ({ page }) => {
      await instalarApiDeContraste(page);
      await page.goto(`/atencion/clases/${CLASE.id}`);
      await page.getByRole('button', { name: /Iniciar para todos/ }).click();

      const resultado = page.getByRole('region', { name: 'Resultado' });
      await expect(resultado.getByText('No tiene una derivación clínica vigente')).toBeVisible();
      await expect(resultado).toBeFocused();

      await auditarContraste(page, 'atencion clinica de una clase con un lote parcial');
    });

    /** Productos de pack y pases (F9, M29): la fila dada de baja y las tres marcas de estado. */
    test('los productos de pack con uno dado de baja', async ({ page }) => {
      await instalarApiDeContraste(page);
      await page.goto('/productos');
      await expect(page.getByText('Pack Pilates 4', { exact: true })).toBeVisible();

      await auditarContraste(page, 'productos de pack con uno dado de baja');
    });

    test('los pases de una persona: activo, agotado y vencido', async ({ page }) => {
      await instalarApiDeContraste(page);
      await page.goto(`/pacientes/${PERSONA_CON_PASES}/pases`);
      await expect(page.getByText('Agotado', { exact: true })).toBeVisible();

      await auditarContraste(page, 'pases de una persona con las tres marcas');
    });

    /** DP-43 (U-12): el catalogo global en la consola, con un plan dado de baja. */
    test('el catalogo global de financiadores de la plataforma', async ({ page }) => {
      await instalarApiDeContraste(page);
      await instalarApiDp43(page, { plataforma: true });
      await page.goto('/plataforma/catalogo-financiadores');
      await expect(page.getByText('Plan 110 Joven')).toBeVisible();

      await auditarContraste(page, 'catalogo global de financiadores de la plataforma');
    });

    test('el catalogo de financiadores del centro, con uno ya agregado y desactualizado', async ({
      page,
    }) => {
      await instalarApiDeContraste(page);
      await instalarApiDp43(page);
      await page.goto('/contratacion/financiadores/catalogo');
      await expect(page.getByText('El catálogo cambio después de agregarlo')).toBeVisible();

      await auditarContraste(page, 'catalogo de financiadores del centro');
    });

    /** DP-43 (U-24, U-25): atender sin turno con el aviso de motivo, y la ventana de enmienda. */
    test('atender sin turno con el motivo faltante', async ({ page }) => {
      await instalarApiDeContraste(page);
      await instalarApiDp43(page);
      await page.goto('/atencion/sin-turno');
      await page
        .getByLabel('Oferta', { exact: true })
        .selectOption({ label: 'Rehabilitacion neurologica' });
      await page.getByRole('button', { name: 'Iniciar atención' }).click();
      await expect(page.getByText('Elegí a quien se atiende.')).toBeVisible();

      await auditarContraste(page, 'atender sin turno con un aviso');
    });

    test('la ventana de enmienda de la organizacion', async ({ page }) => {
      await instalarApiDeContraste(page);
      await instalarApiDp43(page);
      await page.goto('/atencion/politica-de-enmienda');
      await expect(page.getByText('45 días', { exact: true })).toBeVisible();

      await auditarContraste(page, 'ventana de enmienda');
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

function canales(color: string): number[] {
  return (color.match(/[\d.]+/g) ?? []).map(Number);
}

function esTransparente(color: string): boolean {
  const [, , , alfa] = canales(color);
  return alfa === 0;
}

/** Razon de contraste de WCAG 2.1 entre dos colores opacos `rgb(...)`. */
function contraste(uno: string, otro: string): number {
  const luminancia = (color: string): number => {
    const [r, g, b] = canales(color).map((canal) => {
      const v = canal / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [luminancia(uno), luminancia(otro)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
