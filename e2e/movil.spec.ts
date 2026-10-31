import { Page, expect, test } from '@playwright/test';

import {
  CLASE,
  PERSONA_CON_PASES,
  abrirBorradorDeHonorarios,
  instalarApiDeContraste,
} from './support/contraste';
import { FECHA_MOVIL, PERSONA_ID, instalarApiMovil } from './support/movil';
import { instalarApiDp43 } from './support/pantallas-dp43';

/**
 * Auditoria de ANCHO DE TELEFONO: 375 px, el ancho CSS de un telefono chico.
 *
 * <h2>Que se exige</h2>
 *
 * <ol>
 *   <li><b>Sin scroll horizontal de pagina</b> (WCAG 1.4.10, Reflow). Una tabla ancha scrollea
 *       DENTRO de su `.tabla-scroll`; la pagina, nunca: un scroll de pagina esconde la navegacion
 *       y deja el contenido fuera de la vista sin aviso.</li>
 *   <li><b>Ningun elemento visible se sale del viewport</b> fuera de un contenedor que scrollea.
 *       Un `overflow-x: hidden` en el `body` taparia el punto anterior y dejaria el control
 *       cortado e inalcanzable; esto lo atrapa igual.</li>
 *   <li><b>Objetivos de toque de 24 px o mas</b> (WCAG 2.5.8, AA). Exentos, como dice la norma:
 *       los enlaces dentro de una oracion (`p`, `li` con texto alrededor) y los controles que el
 *       agente de usuario dibuja sin estilo propio (no hay ninguno: casillas y radios se agrandan
 *       en `src/design-system.css`).</li>
 * </ol>
 *
 * <p>Las pantallas se pintan CON datos —nombres compuestos, importes de siete cifras, motivos
 * largos—, porque lo que desborda un telefono son las filas reales y no el estado de error. La
 * API se simula (`e2e/support/movil.ts`), como en la auditoria de contraste: corre sin backend.
 */

interface Pantalla {
  readonly nombre: string;
  readonly ruta: string;
  readonly conSesion?: boolean;
  /**
   * Las pantallas de F9 (AKINE-09.02) usan la API simulada del contraste, que ya tiene clases,
   * inscripciones, asistencia, atencion grupal, productos y pases.
   */
  readonly apiDeF9?: boolean;
  /** Las pantallas de DP-43 suman su API (`support/pantallas-dp43.ts`) sobre la del telefono. */
  readonly apiDp43?: { readonly plataforma?: boolean };
  /** Algo que solo aparece cuando la pantalla ya pinto sus datos. */
  readonly listo: (page: Page) => Promise<void>;
}

/** Dentro de `main`: la barra lateral (UX-01) repite los nombres de las secciones, escondida en el telefono. */
const texto = (contenido: string) => async (page: Page) =>
  expect(page.getByRole('main').getByText(contenido).first()).toBeVisible();

const PANTALLAS: readonly Pantalla[] = [
  {
    nombre: 'login',
    ruta: '/auth/ingresar',
    conSesion: false,
    listo: async (page) =>
      expect(page.getByRole('heading', { name: 'Iniciar sesión', level: 1 })).toBeVisible(),
  },
  {
    nombre: 'agenda',
    ruta: `/agenda?fecha=${FECHA_MOVIL}`,
    // En un telefono no se comprime la grilla: es la lista del dia.
    listo: texto('Gomez Iriarte'),
  },
  {
    nombre: 'panel de nuevo turno',
    ruta: `/agenda?fecha=${FECHA_MOVIL}`,
    listo: async (page) => {
      await page.getByRole('button', { name: 'Nuevo turno', exact: true }).click();
      const panel = page.getByRole('dialog', { name: 'Nuevo turno' });
      await panel.getByLabel('Buscar paciente').fill('Gomez');
      await panel.locator('.candidato').first().click();
      await panel.getByRole('button', { name: 'Primer disponible' }).click();
      await expect(panel.getByRole('button', { name: 'Confirmar turno' })).toBeEnabled();
    },
  },
  {
    nombre: 'busqueda de disponibilidad',
    ruta: '/agenda/disponibilidad',
    listo: async (page) => {
      await page.getByLabel('Prestación', { exact: true }).selectOption({ index: 1 });
      await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
    },
  },
  { nombre: 'recepcion', ruta: `/agenda/recepcion?fecha=${FECHA_MOVIL}`, listo: texto('Ibarra') },
  { nombre: 'padron', ruta: '/pacientes', listo: texto('Gomez Iriarte de la Fuente') },
  { nombre: 'paciente 360', ruta: `/pacientes/${PERSONA_ID}`, listo: texto('Coberturas') },
  { nombre: 'caja', ruta: '/caja', listo: texto('Cambio para el dia') },
  { nombre: 'egresos', ruta: '/egresos', listo: texto('Inmobiliaria del Centro') },
  {
    nombre: 'presentaciones',
    ruta: '/presentaciones',
    listo: async (page) =>
      expect(page.getByRole('cell', { name: /OSDE Organizacion/ }).first()).toBeVisible(),
  },
  { nombre: 'reportes', ruta: '/reportes', listo: texto('Reportes') },
  {
    nombre: 'colaboradores',
    ruta: '/organizacion/colaboradores',
    listo: texto('Mariana Sintetica Fernandez'),
  },
  {
    nombre: 'ordenes y autorizaciones',
    ruta: `/pacientes/${PERSONA_ID}/autorizaciones`,
    listo: texto('AUT-OSDE-2026-99887766'),
  },
  // --- F9: clases, asistencia, atencion grupal, productos y pases (AKINE-09.02) -------------
  {
    nombre: 'clases de la semana',
    ruta: '/clases?semana=2026-10-20',
    apiDeF9: true,
    listo: texto('Yoga suave'),
  },
  {
    nombre: 'alta de clase',
    ruta: '/clases/nueva',
    apiDeF9: true,
    listo: async (page) => {
      await page.getByLabel('Oferta grupal').selectOption({ label: 'Pilates reformer' });
      await expect(page.getByLabel('Cupo')).toBeVisible();
    },
  },
  {
    nombre: 'detalle de clase',
    ruta: `/clases/${CLASE.id}`,
    apiDeF9: true,
    listo: texto('Sosa, Eva — posicion 1'),
  },
  {
    nombre: 'tarifas de honorario de una oferta',
    ruta: `/servicios/ofertas/${CLASE.ofertaId}/honorarios`,
    apiDeF9: true,
    listo: texto('Rige hoy'),
  },
  {
    nombre: 'borrador de una liquidacion de honorarios',
    ruta: '/egresos/honorarios',
    apiDeF9: true,
    listo: abrirBorradorDeHonorarios,
  },
  {
    nombre: 'clases del dia',
    ruta: '/asistencia?fecha=2026-10-20',
    apiDeF9: true,
    listo: texto('Yoga suave'),
  },
  {
    nombre: 'asistencia de clase con el resultado de un lote',
    ruta: `/asistencia/${CLASE.id}`,
    apiDeF9: true,
    listo: async (page) => {
      await page.getByRole('button', { name: 'Marcar presentes a los sin marcar' }).click();
      await page.getByRole('button', { name: /Guardar asistencia/ }).click();
      await expect(page.getByRole('region', { name: 'Resultado' })).toBeVisible();
    },
  },
  {
    nombre: 'atencion clinica de la clase',
    ruta: `/atencion/clases/${CLASE.id}`,
    apiDeF9: true,
    listo: texto('Gomez, Luis'),
  },
  {
    nombre: 'productos de pack',
    ruta: '/productos',
    apiDeF9: true,
    listo: texto('Pack Pilates 8'),
  },
  {
    nombre: 'pases de una persona',
    ruta: `/pacientes/${PERSONA_CON_PASES}/pases`,
    apiDeF9: true,
    listo: texto('Agotado'),
  },
  // --- DP-43: catalogo global de financiadores, atencion sin turno y ventana de enmienda -----
  {
    nombre: 'catalogo global de financiadores de la plataforma',
    ruta: '/plataforma/catalogo-financiadores',
    apiDp43: { plataforma: true },
    listo: texto('Plan 210 Integral Familiar con Odontologia'),
  },
  {
    nombre: 'catalogo de financiadores del centro',
    ruta: '/contratacion/financiadores/catalogo',
    apiDp43: {},
    listo: texto('Ya agregado'),
  },
  {
    nombre: 'atender sin turno',
    ruta: '/atencion/sin-turno',
    apiDp43: {},
    listo: async (page) => {
      await page
        .getByLabel('Oferta', { exact: true })
        .selectOption({ label: 'Rehabilitacion neurologica' });
      await expect(page.getByLabel('Motivo (obligatorio)')).toBeVisible();
    },
  },
  {
    nombre: 'ventana de enmienda',
    ruta: '/atencion/politica-de-enmienda',
    apiDp43: {},
    listo: texto('45 días'),
  },
];

/** Lo que se mide en la pagina, ya pintada. */
async function medir(page: Page) {
  return page.evaluate(() => {
    const raiz = document.documentElement;
    const ancho = raiz.clientWidth;

    /** Un ancestro que scrollea en horizontal: lo que se sale de ahi esta a un scroll. */
    const dentroDeUnScroll = (el: Element): boolean => {
      for (let p = el.parentElement; p !== null && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
      return false;
    };
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      const e = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && e.visibility !== 'hidden';
    };
    const nombre = (el: Element): string => {
      const id = el.id ? `#${el.id}` : '';
      const clases = [...el.classList].filter((c) => !c.startsWith('ng-')).join('.');
      const rotulo = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}${id}${clases ? '.' + clases : ''} "${rotulo}"`;
    };

    const fuera: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || dentroDeUnScroll(el)) continue;
      const r = el.getBoundingClientRect();
      // Entero a la izquierda del viewport es el patron del skip link en reposo: no se ve ni
      // agrega scroll (a la izquierda del origen no se puede desplazar).
      if (r.right <= 0) continue;
      if (r.right > ancho + 0.5 || r.left < -0.5) {
        fuera.push(`${nombre(el)} va de ${Math.round(r.left)} a ${Math.round(r.right)} px`);
      }
    }

    /** WCAG 2.5.8: un enlace en una oracion esta exento. */
    const enUnaOracion = (el: Element): boolean => {
      if (el.tagName !== 'A') return false;
      const bloque = el.closest('p, li, dd, td');
      if (bloque === null) return false;
      const resto = (bloque.textContent ?? '').replace(el.textContent ?? '', '').trim();
      return resto.length > 0;
    };

    const chicos: string[] = [];
    const operables = document.querySelectorAll(
      'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex="0"]',
    );
    for (const el of operables) {
      if (!visible(el) || enUnaOracion(el)) continue;
      // Una casilla o un radio dentro de su `label` se activa tocando el rotulo entero: el
      // objetivo es la etiqueta, y es la que se mide.
      const envoltorio = el.matches('input[type=checkbox], input[type=radio]')
        ? el.closest('label')
        : null;
      const r = (envoltorio ?? el).getBoundingClientRect();
      if (r.width < 24 || r.height < 24) {
        chicos.push(`${nombre(el)} mide ${Math.round(r.width)}x${Math.round(r.height)} px`);
      }
    }

    return { anchoDePagina: raiz.scrollWidth, ancho, fuera, chicos };
  });
}

test.describe('Ancho de telefono (375 px)', () => {
  for (const pantalla of PANTALLAS) {
    test(`${pantalla.nombre} no desborda y sus controles se pueden tocar`, async ({ page }) => {
      if (pantalla.apiDeF9) {
        await instalarApiDeContraste(page);
      } else {
        await instalarApiMovil(page, { conSesion: pantalla.conSesion ?? true });
      }
      if (pantalla.apiDp43 !== undefined) {
        await instalarApiDp43(page, pantalla.apiDp43);
      }
      await page.goto(pantalla.ruta);
      await pantalla.listo(page);

      const medido = await medir(page);

      expect(
        medido.anchoDePagina,
        `${pantalla.nombre}: la pagina scrollea en horizontal (${medido.anchoDePagina} px de ` +
          `contenido en ${medido.ancho} px). Lo que se sale:\n${medido.fuera.join('\n')}`,
      ).toBeLessThanOrEqual(medido.ancho);
      expect(
        medido.fuera,
        `${pantalla.nombre}: elementos fuera del viewport sin un contenedor que scrollee`,
      ).toEqual([]);
      expect(
        medido.chicos,
        `${pantalla.nombre}: objetivos de toque de menos de 24 px (WCAG 2.5.8)`,
      ).toEqual([]);
    });
  }
});
