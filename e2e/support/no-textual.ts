import { Page, Request, Route, expect, test } from '@playwright/test';

/**
 * Arnes de CONTRASTE NO TEXTUAL, FOCO VISIBLE y RECORRIDO POR TECLADO (AKINE-G-7).
 *
 * <h2>Que hueco cierra</h2>
 *
 * <p>`e2e/contraste.spec.ts` mide texto con la regla `color-contrast` de axe. axe no tiene regla
 * automatica para tres cosas que WCAG 2.1 AA igual exige, y que hasta esta etapa no media nadie:
 *
 * <ul>
 *   <li><b>1.4.11 — contraste de lo que no es texto (3:1).</b> El borde de un `input`, el contorno
 *       de un boton y el anillo de foco tienen que distinguirse del fondo que los rodea.</li>
 *   <li><b>2.4.7 — foco visible.</b> Cada elemento que el teclado alcanza tiene que mostrar un
 *       indicador PROPIO del sistema de diseno, no el anillo por defecto del navegador —que en la
 *       barra de marca oscura se pierde—, y ese indicador tiene que llegar a 3:1.</li>
 *   <li><b>Estados `:hover`.</b> axe audita la pantalla en reposo; un token de hover que baje el
 *       texto de 4,5:1 no lo ve ninguna herramienta.</li>
 * </ul>
 *
 * <p>Y una cuarta que no es de color: <b>2.1.1 / 2.1.2 / 2.4.3</b> — que el Tab recorra los
 * controles en el orden del documento, que no haya trampas de foco y que no exista un
 * `tabindex` positivo que reordene la pantalla a espaldas del DOM.
 *
 * <h2>Como mide</h2>
 *
 * <p>Con los colores COMPUTADOS por Chromium —la cascada real, los dos temas, las variables ya
 * resueltas— y la aritmetica de luminancia relativa de WCAG 2.1, la misma que usa el arnes de
 * texto. El fondo de referencia es siempre <b>el primer fondo opaco de la cadena de ancestros</b>:
 * es el color sobre el que se ve el borde o el anillo.
 *
 * <p><b>El foco se mide recorriendo con Tab de verdad</b>, no llamando a `focus()`: asi se
 * evalua `:focus-visible` exactamente como lo ve un usuario de teclado, y el mismo recorrido
 * sirve para verificar el orden y la ausencia de trampas.
 */

/** Minimo de WCAG 1.4.11 para un componente de interfaz y para el indicador de foco. */
export const MINIMO_NO_TEXTUAL = 3;

/** Grosor minimo del anillo de foco, en px. Por debajo de 2 px el anillo no se percibe. */
export const GROSOR_MINIMO_DE_FOCO = 2;

// ---------------------------------------------------------------------------------------------
// Mediciones (corren dentro de la pagina)
// ---------------------------------------------------------------------------------------------

export interface MedicionDeFoco {
  readonly elemento: string;
  readonly estilo: string;
  readonly grosor: number;
  readonly color: string;
  readonly fondo: string;
  readonly ratio: number;
}

export interface MedicionDeBorde {
  readonly elemento: string;
  readonly borde: string;
  readonly relleno: string | null;
  readonly fondo: string;
  /** El mejor de los dos: el contorno se identifica por el borde O por el relleno. */
  readonly ratio: number;
}

export interface MedicionDeHover {
  readonly elemento: string;
  readonly texto: string;
  readonly fondoTexto: string;
  readonly ratioTexto: number;
  readonly minimoTexto: number;
  /** Contorno en hover, solo para controles con caja (no para enlaces de texto). */
  readonly ratioContorno: number | null;
}

/**
 * Funciones de color y de seleccion que se inyectan en la pagina. Van como texto porque
 * `page.evaluate` serializa la funcion y pierde el cierre lexico: asi las tres mediciones
 * comparten UNA sola aritmetica en vez de tres copias.
 */
const AYUDANTES = `
  window.__akineA11y = (() => {
    function canales(color) {
      const crudo = (color.match(/[\\d.]+/g) || ['0', '0', '0']).map(Number);
      return [crudo[0], crudo[1], crudo[2], crudo[3] === undefined ? 1 : crudo[3]];
    }
    function luminancia(color) {
      const [r, g, b] = canales(color);
      const lineal = [r, g, b].map((c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * lineal[0] + 0.7152 * lineal[1] + 0.0722 * lineal[2];
    }
    function ratio(a, b) {
      const la = luminancia(a);
      const lb = luminancia(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }
    function opaco(color) {
      return canales(color)[3] === 1;
    }
    function fondoOpaco(desde) {
      let nodo = desde;
      while (nodo) {
        const color = getComputedStyle(nodo).backgroundColor;
        if (opaco(color)) return color;
        nodo = nodo.parentElement;
      }
      return getComputedStyle(document.documentElement).backgroundColor;
    }
    function visible(el) {
      const estilo = getComputedStyle(el);
      if (estilo.visibility === 'hidden' || estilo.display === 'none') return false;
      return el.getClientRects().length > 0;
    }
    function nombre(el) {
      const texto = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '')
        .replace(/\\s+/g, ' ').trim().slice(0, 40);
      const id = el.id ? '#' + el.id : '';
      const clase = el.classList.length ? '.' + [...el.classList].join('.') : '';
      return el.tagName.toLowerCase() + id + clase + (texto ? ' "' + texto + '"' : '');
    }
    return { canales, ratio, opaco, fondoOpaco, visible, nombre };
  })();
`;

async function instalarAyudantes(page: Page): Promise<void> {
  await page.evaluate(AYUDANTES);
}

interface Ayudantes {
  ratio(a: string, b: string): number;
  opaco(color: string): boolean;
  fondoOpaco(desde: Element | null): string;
  visible(el: Element): boolean;
  nombre(el: Element): string;
}

/** Lo que mide el foco del elemento activo. `null` si el foco no esta en un elemento. */
async function medirFocoActivo(page: Page): Promise<MedicionDeFoco | null> {
  return page.evaluate(() => {
    const a = (window as unknown as { __akineA11y: Ayudantes }).__akineA11y;
    const el = document.activeElement;
    if (el === null || el === document.body || el === document.documentElement) {
      return null;
    }
    const estilo = getComputedStyle(el);
    const offset = Number.parseFloat(estilo.outlineOffset) || 0;
    const grosor = Number.parseFloat(estilo.outlineWidth) || 0;
    const fondoExterior = a.fondoOpaco(el.parentElement);
    const fondoPropio = a.fondoOpaco(el);
    // Donde cae el anillo decide contra que se mide: hacia afuera (offset > 0) lo rodea el fondo
    // del contenedor; hacia adentro del todo (offset <= -grosor) solo el relleno del control; en
    // el medio toca los dos y tiene que separarse de ambos.
    const exterior = offset > -grosor;
    const interior = offset <= 0;
    const fondo = exterior ? fondoExterior : fondoPropio;
    let medido = a.ratio(estilo.outlineColor, fondo);
    if (exterior && interior) {
      medido = Math.min(medido, a.ratio(estilo.outlineColor, fondoPropio));
    }
    return {
      elemento: a.nombre(el),
      estilo: estilo.outlineStyle,
      grosor,
      color: estilo.outlineColor,
      fondo,
      ratio: medido,
    };
  });
}

/** Firma estable del elemento activo, para comparar el orden del recorrido. */
async function firmaActiva(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body || el === document.documentElement) return null;
    const indice = [...document.querySelectorAll('*')].indexOf(el);
    return `${indice}|${(window as unknown as { __akineA11y: Ayudantes }).__akineA11y.nombre(el)}`;
  });
}

/**
 * Los elementos que el Tab TIENE que recorrer, en orden de documento.
 *
 * <p>De un grupo de radios entra uno solo -el marcado, o el primero-, que es como lo recorre
 * el navegador. Un `tabindex` positivo se informa aparte: es un defecto por si mismo.
 */
async function tabulablesEsperados(
  page: Page,
): Promise<{ firmas: string[]; tabindexPositivo: string[] }> {
  return page.evaluate(() => {
    const a = (window as unknown as { __akineA11y: Ayudantes }).__akineA11y;
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      'summary',
      '[tabindex]',
    ].join(',');
    const todos = [...document.querySelectorAll('*')];
    const radiosVistos = new Set<string>();
    const firmas: string[] = [];
    const tabindexPositivo: string[] = [];

    for (const el of document.querySelectorAll(selector)) {
      const html = el as HTMLElement;
      if (html.tabIndex < 0 || !a.visible(el) || html.closest('[inert]') !== null) continue;
      if (html.tabIndex > 0) tabindexPositivo.push(a.nombre(el));
      if (el instanceof HTMLInputElement && el.type === 'radio') {
        const grupo = el.name || el.id;
        const marcado = document.querySelector(`input[type="radio"][name="${grupo}"]:checked`);
        if (radiosVistos.has(grupo)) continue;
        if (marcado !== null && marcado !== el) continue;
        radiosVistos.add(grupo);
      }
      firmas.push(`${todos.indexOf(el)}|${a.nombre(el)}`);
    }
    return { firmas, tabindexPositivo };
  });
}

/**
 * Bordes y rellenos de los controles operables, en reposo (WCAG 1.4.11).
 *
 * <p>Los deshabilitados quedan fuera: 1.4.11 exime a los componentes inactivos, y su contraste
 * de TEXTO ya lo mide el arnes de `contraste.spec.ts`. Checkbox y radio nativos tambien: los
 * dibuja el navegador con su propia apariencia, que WCAG exime cuando el autor no la toca.
 */
async function medirBordes(page: Page): Promise<MedicionDeBorde[]> {
  return page.evaluate(() => {
    const a = (window as unknown as { __akineA11y: Ayudantes }).__akineA11y;
    const selector =
      'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not(:disabled),' +
      'select:not(:disabled), textarea:not(:disabled), button:not(:disabled), a.boton';
    const medidos: MedicionDeBorde[] = [];
    for (const el of document.querySelectorAll(selector)) {
      if (!a.visible(el)) continue;
      const estilo = getComputedStyle(el);
      const fondo = a.fondoOpaco(el.parentElement);
      const conBorde =
        estilo.borderTopStyle !== 'none' && Number.parseFloat(estilo.borderTopWidth) > 0;
      const borde = conBorde ? estilo.borderTopColor : fondo;
      const relleno = a.opaco(estilo.backgroundColor) ? estilo.backgroundColor : null;
      medidos.push({
        elemento: a.nombre(el),
        borde,
        relleno,
        fondo,
        ratio: Math.max(a.ratio(borde, fondo), relleno === null ? 0 : a.ratio(relleno, fondo)),
      });
    }
    return medidos;
  });
}

// ---------------------------------------------------------------------------------------------
// Las auditorias
// ---------------------------------------------------------------------------------------------

export interface ResultadoDelRecorrido {
  readonly orden: string[];
  readonly focos: MedicionDeFoco[];
}

/**
 * Recorre la pantalla con Tab desde el principio del documento y falla si:
 *
 * <ol>
 *   <li>el primer elemento no es el skip link (ADR-0005), cuando la pantalla lo tiene;</li>
 *   <li>el orden del Tab no coincide con el orden del documento —un `tabindex` positivo, un
 *       control que el Tab se saltea o uno que aparece dos veces son el mismo sintoma—;</li>
 *   <li>el foco no vuelve a salir del documento al final (trampa de foco);</li>
 *   <li>algun elemento enfocado no muestra un anillo propio, de al menos 2 px, que llegue a 3:1
 *       contra el fondo que lo rodea.</li>
 * </ol>
 */
export async function recorrerConTeclado(
  page: Page,
  donde: string,
): Promise<ResultadoDelRecorrido> {
  await instalarAyudantes(page);
  // Sin foco y sin punto de partida: el primer Tab va al primer tabulable del documento.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 0);

  const { firmas: esperado, tabindexPositivo } = await tabulablesEsperados(page);
  expect
    .soft(tabindexPositivo, `${donde}: tabindex positivo reordena el Tab a espaldas del DOM`)
    .toEqual([]);

  const orden: string[] = [];
  const focos: MedicionDeFoco[] = [];
  const tope = esperado.length + 15;
  let salio = false;

  for (let paso = 0; paso < tope; paso++) {
    await page.keyboard.press('Tab');
    const firma = await firmaActiva(page);
    if (firma === null) {
      salio = true;
      break;
    }
    // Un `input[type=date]` recorre sus segmentos internos con el foco en el mismo elemento.
    if (orden[orden.length - 1] === firma) continue;
    if (orden.includes(firma)) {
      // Volvio a un elemento ya visitado sin salir del documento: el foco esta atrapado o dio
      // la vuelta. Las dos cosas fallan abajo con el orden completo a la vista.
      break;
    }
    orden.push(firma);
    const foco = await medirFocoActivo(page);
    if (foco !== null) focos.push(foco);
  }

  expect
    .soft(
      orden.map(soloNombre),
      `${donde}: el Tab no recorre los controles en el orden del documento`,
    )
    .toEqual(esperado.map(soloNombre));
  expect
    .soft(salio, `${donde}: el foco no sale del documento al final del recorrido (trampa)`)
    .toBe(true);

  const sinIndicador = focos.filter(
    (f) => f.estilo === 'none' || f.estilo === 'auto' || f.grosor < GROSOR_MINIMO_DE_FOCO,
  );
  expect
    .soft(
      sinIndicador.map((f) => `${f.elemento}: outline ${f.estilo} ${f.grosor}px`),
      `${donde}: elementos enfocables sin el anillo de foco del sistema de diseno ` +
        `(se exige outline solido de ${GROSOR_MINIMO_DE_FOCO}px o mas; "auto" es el del navegador)`,
    )
    .toEqual([]);

  const bajos = focos.filter((f) => f.ratio < MINIMO_NO_TEXTUAL);
  expect
    .soft(
      bajos.map(
        (f) => `${f.elemento}: anillo ${f.color} sobre ${f.fondo} = ${f.ratio.toFixed(2)}:1`,
      ),
      `${donde}: anillo de foco por debajo de ${MINIMO_NO_TEXTUAL}:1 (WCAG 1.4.11 / 2.4.7). Se ` +
        'corrige el TOKEN de foco, no el componente.',
    )
    .toEqual([]);

  informar(
    donde,
    'foco',
    focos.map((f) => [f.elemento, f.ratio]),
  );
  return { orden, focos };
}

function soloNombre(firma: string): string {
  return firma.slice(firma.indexOf('|') + 1);
}

/** Contorno de los controles operables en reposo, contra el fondo que los rodea (1.4.11). */
export async function auditarBordes(page: Page, donde: string): Promise<MedicionDeBorde[]> {
  await instalarAyudantes(page);
  const medidos = await medirBordes(page);
  expect.soft(medidos.length, `${donde}: no se midio ningun control`).toBeGreaterThan(0);

  const bajos = medidos.filter((m) => m.ratio < MINIMO_NO_TEXTUAL);
  expect
    .soft(
      bajos.map(
        (m) =>
          `${m.elemento}: borde ${m.borde}${m.relleno ? ` / relleno ${m.relleno}` : ''} sobre ` +
          `${m.fondo} = ${m.ratio.toFixed(2)}:1`,
      ),
      `${donde}: contorno de control por debajo de ${MINIMO_NO_TEXTUAL}:1 (WCAG 1.4.11)`,
    )
    .toEqual([]);

  informar(
    donde,
    'borde',
    medidos.map((m) => [m.elemento, m.ratio]),
  );
  return medidos;
}

/**
 * Pasa el mouse por cada boton y enlace operable y mide, EN HOVER, el texto contra su fondo
 * (4,5:1, o 3:1 si es texto grande) y el contorno de los controles con caja (3:1).
 */
export async function auditarHover(page: Page, donde: string): Promise<MedicionDeHover[]> {
  await instalarAyudantes(page);
  const candidatos = page.locator('a[href], button:not(:disabled), .boton:not(:disabled)');
  const total = await candidatos.count();
  const medidos: MedicionDeHover[] = [];

  for (let i = 0; i < total; i++) {
    const candidato = candidatos.nth(i);
    if (!(await candidato.isVisible())) continue;
    // El skip link vive fuera de la pantalla hasta que recibe foco: no hay hover que medir.
    const caja = await candidato.boundingBox();
    if (caja === null || caja.x + caja.width <= 0) continue;
    await candidato.scrollIntoViewIfNeeded();
    await candidato.hover();
    medidos.push(
      await candidato.evaluate((el) => {
        const a = (window as unknown as { __akineA11y: Ayudantes }).__akineA11y;
        const estilo = getComputedStyle(el);
        const fondoTexto = a.fondoOpaco(el);
        const px = Number.parseFloat(estilo.fontSize);
        const negrita = Number.parseInt(estilo.fontWeight, 10) >= 700;
        const conCaja = el.matches('button, .boton');
        let contorno: number | null = null;
        if (conCaja) {
          const exterior = a.fondoOpaco(el.parentElement);
          const conBorde =
            estilo.borderTopStyle !== 'none' && Number.parseFloat(estilo.borderTopWidth) > 0;
          const borde = conBorde ? estilo.borderTopColor : exterior;
          const relleno = a.opaco(estilo.backgroundColor) ? estilo.backgroundColor : null;
          contorno = Math.max(
            a.ratio(borde, exterior),
            relleno === null ? 0 : a.ratio(relleno, exterior),
          );
        }
        return {
          elemento: a.nombre(el),
          texto: estilo.color,
          fondoTexto,
          ratioTexto: a.ratio(estilo.color, fondoTexto),
          minimoTexto: px >= 24 || (negrita && px >= 18.66) ? 3 : 4.5,
          ratioContorno: contorno,
        };
      }),
    );
  }
  await page.mouse.move(0, 0);

  expect
    .soft(medidos.length, `${donde}: no se paso el mouse por ningun control`)
    .toBeGreaterThan(0);
  const bajos = medidos.filter(
    (m) =>
      m.ratioTexto < m.minimoTexto ||
      (m.ratioContorno !== null && m.ratioContorno < MINIMO_NO_TEXTUAL),
  );
  expect
    .soft(
      bajos.map(
        (m) =>
          `${m.elemento}: texto ${m.texto} sobre ${m.fondoTexto} = ${m.ratioTexto.toFixed(2)}:1` +
          (m.ratioContorno === null ? '' : `, contorno ${m.ratioContorno.toFixed(2)}:1`),
      ),
      `${donde}: un estado :hover baja el contraste bajo el minimo`,
    )
    .toEqual([]);

  informar(
    donde,
    'hover',
    medidos.map((m) => [m.elemento, Math.min(m.ratioTexto, m.ratioContorno ?? Infinity)]),
  );
  return medidos;
}

/**
 * Con `A11Y_REPORTE=1` imprime el minimo de cada familia de medicion: es lo que se copia al
 * registro de la etapa como "antes" y "despues". Sin la variable no ensucia la salida.
 */
function informar(donde: string, que: string, filas: [string, number][]): void {
  if (process.env['A11Y_REPORTE'] !== '1' || filas.length === 0) return;
  const peor = filas.reduce((min, fila) => (fila[1] < min[1] ? fila : min));
  console.log(
    `[a11y] ${test.info().project.name} | ${donde} | ${que}: ${filas.length} medidos, minimo ` +
      `${peor[1].toFixed(2)}:1 en ${peor[0]}`,
  );
}

// ---------------------------------------------------------------------------------------------
// API simulada de las pantallas del recorrido
// ---------------------------------------------------------------------------------------------

export const ORGANIZATION_ID = 1;
export const CONSULTORIO_ID = 3;
export const PERSONA_ID = 41;
export const FECHA = '2026-10-07';

const CONTEXTOS = [
  {
    organizationId: ORGANIZATION_ID,
    organizationName: 'Centro Kine Belgrano',
    consultorioId: CONSULTORIO_ID,
    consultorioName: 'Sede Centro',
  },
  {
    organizationId: ORGANIZATION_ID,
    organizationName: 'Centro Kine Belgrano',
    consultorioId: 4,
    consultorioName: 'Sede Norte',
  },
];

const PERMISOS = [
  'tenant:read',
  'turno:read',
  'turno:manage',
  'cobro:register',
  'caja:operate',
  'paciente:manage',
];

/** Una fila por estado de recepcion que dibuja acciones distintas, y una cancelada. */
const TURNOS_DEL_DIA = [
  {
    id: 301,
    estado: 'CONFIRMADO',
    inicio: `${FECHA}T12:00:00Z`,
    fin: `${FECHA}T12:45:00Z`,
    personaNombre: 'Ramirez, Ana',
    documento: 'DNI 27888999',
    ofertaId: 77,
    ofertaNombre: 'Kinesiologia deportiva',
    version: 2,
  },
  {
    id: 304,
    estado: 'RESERVADO',
    inicio: `${FECHA}T15:00:00Z`,
    fin: `${FECHA}T15:45:00Z`,
    llegadaEn: `${FECHA}T14:55:00Z`,
    recepcion: {
      id: 904,
      turnoId: 304,
      estado: 'LLEGO',
      llegadaEn: `${FECHA}T14:55:00Z`,
      version: 1,
    },
    personaNombre: 'Ibarra, Dario',
    documento: 'DNI 35666777',
    ofertaId: 77,
    ofertaNombre: 'Kinesiologia deportiva',
    version: 4,
  },
  {
    id: 303,
    estado: 'CANCELADO',
    inicio: `${FECHA}T14:00:00Z`,
    fin: `${FECHA}T14:45:00Z`,
    motivoCancelacion: 'El profesional pidio el dia',
    personaNombre: 'Vega, Carla',
    documento: 'DNI 33444555',
    ofertaId: 77,
    ofertaNombre: 'Kinesiologia deportiva',
    version: 3,
  },
];

const JORNADA = {
  id: 77,
  consultorioId: CONSULTORIO_ID,
  estado: 'ABIERTA',
  moneda: 'ARS',
  fechaNegocio: FECHA,
  abiertaEn: `${FECHA}T11:00:00Z`,
  saldoInicial: 1000,
  saldoTeorico: 1500.5,
  totalesPorMedio: [{ medio: 'EFECTIVO', total: 500.5, afectaArqueo: true }],
};

const MOVIMIENTOS = [
  {
    id: 501,
    jornadaCajaId: 77,
    tipo: 'INGRESO',
    tipoOrigen: 'MANUAL',
    medio: 'EFECTIVO',
    importe: 500.5,
    moneda: 'ARS',
    concepto: 'Cambio para el dia',
    registradoEn: `${FECHA}T11:05:00Z`,
  },
];

const COBRO = {
  id: 5001,
  comprobanteNumero: 142,
  consultorioId: CONSULTORIO_ID,
  personaId: PERSONA_ID,
  moneda: 'ARS',
  total: 8500.5,
  cobradoEn: '2026-09-15T13:02:00Z',
  medios: [{ medio: 'EFECTIVO', importe: 8500.5 }],
  imputaciones: [{ obligacionId: 9001, importe: 8500.5 }],
  version: 0,
};

const PERSONA = {
  id: PERSONA_ID,
  tipoDocumento: 'DNI',
  numeroDocumento: '28444555',
  apellido: 'Gomez Iriarte',
  nombre: 'Luis Alberto',
  esPaciente: true,
  perfilPacienteId: 7,
  estado: 'ACTIVO',
  version: 3,
};

/**
 * Instala la API simulada de las pantallas del recorrido. `conContexto: false` deja la sesion
 * en `pre_context`, que es la unica forma de llegar al selector de contexto con dos opciones.
 *
 * <p>Un endpoint sin stub responde 501 y rompe la pantalla a la vista: si una pantalla empieza a
 * pedir algo nuevo, el recorrido lo delata en vez de auditar un estado que no es el real.
 */
export async function instalarApiDelRecorrido(
  page: Page,
  opciones: { readonly conContexto?: boolean } = {},
): Promise<void> {
  const conContexto = opciones.conContexto ?? true;

  await page.route('**/api/v1/**', async (ruta: Route) => {
    const peticion: Request = ruta.request();
    const url = new URL(peticion.url());
    const camino = url.pathname;
    const metodo = peticion.method();
    const json = (cuerpo: unknown, status = 200): Promise<void> =>
      ruta.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) });

    if (camino === '/api/v1/auth/refresh') {
      return json(
        conContexto
          ? {
              accessToken: 'token-sintetico-de-teclado',
              scope: 'context',
              organizationId: ORGANIZATION_ID,
              consultorioId: CONSULTORIO_ID,
            }
          : { accessToken: 'token-sintetico-de-teclado', scope: 'pre_context' },
      );
    }
    if (camino === '/api/v1/auth/context') {
      return json({
        accessToken: 'token-sintetico-de-teclado',
        scope: 'context',
        organizationId: ORGANIZATION_ID,
        consultorioId: CONSULTORIO_ID,
      });
    }
    if (camino === '/api/v1/me/contexts') return json(CONTEXTOS);
    if (camino === '/api/v1/me/permissions') return json({ permissions: PERMISOS });

    const base = `/api/v1/consultorios/${CONSULTORIO_ID}`;
    if (camino === `${base}/turnos` && metodo === 'GET') {
      return json({ fecha: FECHA, timezone: 'America/Argentina/Cordoba', turnos: TURNOS_DEL_DIA });
    }
    if (camino === `${base}/caja/jornadas` && metodo === 'GET') return json([JORNADA]);
    if (camino === `${base}/caja/jornadas/${JORNADA.id}` && metodo === 'GET') return json(JORNADA);
    if (camino === `${base}/caja/movimientos` && metodo === 'GET') return json(MOVIMIENTOS);
    if (camino === `${base}/cobros` && metodo === 'GET') return json([COBRO]);
    if (camino === `${base}/cobros/${COBRO.id}` && metodo === 'GET') return json(COBRO);
    if (camino === `/api/v1/personas/${PERSONA_ID}` && metodo === 'GET') return json(PERSONA);

    return ruta.fulfill({
      status: 501,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'https://akine.app/problems/not-implemented',
        title: 'not-implemented',
        status: 501,
        detail: `El arnes de teclado no simula ${metodo} ${camino}`,
      }),
    });
  });
}
