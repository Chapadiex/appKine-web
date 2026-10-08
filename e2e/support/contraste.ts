import { createRequire } from 'node:module';
import { join } from 'node:path';

import { Page, Request, Route, expect } from '@playwright/test';

/**
 * Arnes de la auditoria de CONTRASTE DE COLOR (WCAG 1.4.3 y 1.4.11, nivel AA).
 *
 * <h2>Por que esto no podia vivir en los tests unitarios</h2>
 *
 * <p>El repositorio audita accesibilidad con axe desde AKINE-01.02, pero bajo <b>jsdom</b>, que
 * no calcula layout ni resuelve el color heredado de un ancestro. En ese entorno la regla
 * `color-contrast` nunca puede decidir: devuelve `incomplete` —"no pude comprobarlo"— y jamas
 * `violations`. Una suite que solo mira `violations` <b>pasa en verde sin haber medido nada</b>,
 * y eso es exactamente lo que el `CLAUDE.md` del workspace venia declarando como hueco abierto:
 * "el contraste de color no esta verificado en ninguna parte".
 *
 * <p>Chromium si calcula layout. Aca la misma regla devuelve `passes` y `violations` de verdad,
 * con el ratio medido, los dos colores y el minimo exigido.
 *
 * <h2>Por que la API se simula</h2>
 *
 * <p>Mismo criterio —y mismo mecanismo, `route.fulfill`— que `e2e/support/agenda-simulada.ts`:
 * lo unico sintetico es la respuesta HTTP. El navegador, el router, los guards, los signals, las
 * hojas de estilo, la cascada y el calculo de color son <b>reales</b>, y son lo unico que esta
 * auditoria necesita que sea real. Para medir un contraste no hace falta un backend: hace falta
 * que la pantalla se pinte.
 *
 * <p>Los fixtures son los mismos datos sinteticos que ya usan los otros harnesses. <b>No se
 * maquilla ningun dato para que un contraste de bien</b>: al contrario, los estados se eligen
 * para forzar los pares de color que mas fallan —error, vacio, deshabilitado, fila dada de baja—.
 */

/**
 * El bundle de axe que se inyecta en la pagina. Es el mismo paquete que usa la suite de jsdom.
 *
 * <p>Se resuelve desde el directorio de trabajo y no desde `import.meta.url`: Playwright transpila
 * los specs a CommonJS, donde `import.meta` es un error de sintaxis y el archivo entero deja de
 * cargar —sintoma observado: "No tests found", que es el peor de todos porque parece que no habia
 * nada que correr—.
 */
const RUTA_AXE: string = createRequire(join(process.cwd(), 'playwright.config.ts')).resolve(
  'axe-core/axe.min.js',
);

export const ORGANIZATION_ID = 1;
export const CONSULTORIO_ID = 3;

/**
 * Nivel exigido: <b>AA</b>.
 *
 * <p>Es el piso que `AGENT.md` 8 declara requisito y no aspiracion. AAA no se exige: obligaria a
 * 7:1 en texto normal, que en una interfaz densa de tablas empuja a un blanco y negro sin
 * jerarquia visual. La etiqueta de axe que fija ese piso es `wcag143` para texto y `wcag1411`
 * para los bordes de un control.
 */
export const NIVEL = 'AA';

// ---------------------------------------------------------------------------------------------
// La auditoria
// ---------------------------------------------------------------------------------------------

interface DatosDeContraste {
  readonly fgColor?: string;
  readonly bgColor?: string;
  readonly contrastRatio?: number;
  readonly expectedContrastRatio?: string;
  readonly fontSize?: string;
  readonly fontWeight?: string;
}

interface NodoDeAxe {
  readonly target: string[];
  readonly html: string;
  readonly any: { readonly id: string; readonly data?: DatosDeContraste }[];
}

interface ResultadoDeAxe {
  readonly id: string;
  readonly nodes: NodoDeAxe[];
}

interface CorridaDeAxe {
  readonly violations: ResultadoDeAxe[];
  readonly incomplete: ResultadoDeAxe[];
  readonly passes: ResultadoDeAxe[];
}

/**
 * Corre `color-contrast` sobre la pagina entera y falla si algun par no llega al minimo de AA.
 *
 * <p><b>Tres afirmaciones, no una.</b> Un test de contraste que solo mira `violations` puede
 * quedar en verde por dos motivos opuestos, y hay que poder distinguirlos:
 *
 * <ol>
 *   <li><b>No hay violaciones.</b> Es lo que se quiere.</li>
 *   <li><b>La regla no midio nada</b> —la pantalla no llego a pintar, el selector no encontro
 *       texto, axe se inyecto en un documento vacio—. Sin la segunda afirmacion esto se lee
 *       igual que el caso anterior, y es el <b>mismo error</b> que la suite de jsdom venia
 *       cometiendo en silencio. Por eso se exige que `passes` traiga nodos: si axe no tuvo nada
 *       que medir, el test rompe.</li>
 *   <li><b>La regla no pudo decidir</b> (`incomplete`). No se tolera en silencio: o se mide de
 *       otra forma —ver {@link FondoConDegrade}— o rompe el test.</li>
 * </ol>
 *
 * @param page la pagina ya pintada en el estado que se quiere auditar
 * @param donde nombre humano del estado auditado; sale en el mensaje de fallo
 * @param opciones las zonas que axe no mide y que hay que medir de otra forma
 */
export async function auditarContraste(
  page: Page,
  donde: string,
  opciones: {
    readonly degrade?: FondoConDegrade;
    readonly queAxeNoMide?: readonly QueAxeNoMide[];
  } = {},
): Promise<void> {
  await page.addScriptTag({ path: RUTA_AXE });

  const aMano = (opciones.queAxeNoMide ?? []).map((zona) => zona.selector);
  const {
    axe: resultado,
    medidos,
    vacios,
  } = await correr(page, opciones.degrade?.selector ?? null, aMano);

  // Un selector declarado que hoy no existe es una declaracion vieja: la zona dejo de estar sin
  // medir, o -peor- el selector se escribio mal y nunca midio nada.
  expect(
    vacios,
    `${donde} declara zonas que axe no mide y que este arnes tiene que medir a mano, y estas no ` +
      `existen en la pantalla: ${vacios.join(', ')}. O el estado no se llego a montar, o la ` +
      'declaracion quedo vieja.',
  ).toEqual([]);

  const fallos = [
    ...detallar(resultado.violations, 'VIOLACION'),
    ...detallar(resultado.incomplete, 'SIN MEDIR'),
    ...medidos.filter((nodo) => nodo.ratio < nodo.minimo).map(describirMedicionPropia),
  ];

  expect(
    fallos,
    `Contraste ${NIVEL} en ${donde}:\n${fallos.join('\n')}\n` +
      'Los colores salen de la capa de tokens de `src/design-system.css`. Se corrige el TOKEN, ' +
      'no el componente: un parche local reaparece en la proxima pantalla que use el mismo par.',
  ).toEqual([]);

  expect(
    contarNodos(resultado.passes) + medidos.length,
    `no se midio ni un solo par de colores en ${donde}. La pantalla no llego a pintar, o el ` +
      'contexto de la auditoria quedo vacio: un cero aca NO es "sin violaciones", es "sin medir".',
  ).toBeGreaterThan(0);

  if (opciones.degrade !== undefined) {
    // Una tolerancia que ya no corresponde es peor que ninguna: si el degrade se fue, esto lo
    // dice en vez de dejar la excepcion escrita para siempre.
    expect(
      medidos.filter((nodo) => nodo.origen === 'degrade').length,
      `${donde} declara que \`${opciones.degrade.selector}\` tiene un fondo que axe no puede ` +
        'aplanar, y axe midio todo sin problemas. La declaracion quedo vieja: borrala.',
    ).toBeGreaterThan(0);
  }
}

function contarNodos(resultados: readonly ResultadoDeAxe[]): number {
  return resultados.reduce((total, resultado) => total + resultado.nodes.length, 0);
}

function describirMedicionPropia(nodo: MedicionPropia): string {
  return (
    `  [VIOLACION, medida por el arnes contra el fondo opaco] ${nodo.selector} -> medido ` +
    `${nodo.ratio.toFixed(2)}:1, exigido ${nodo.minimo}:1 (texto ${nodo.color} sobre fondo ` +
    `${nodo.fondo})`
  );
}

/**
 * Una zona que la regla `color-contrast` <b>no evalua nunca</b>, por diseno de axe.
 *
 * <p><b>El caso que motivo esto, y que vale contar.</b> El estado mas citado como problematico
 * de contraste es el boton deshabilitado. Se audito ese estado, se rompio el token
 * `--color-deshabilitado` a proposito para comprobar que el gate lo agarraba... y <b>no lo
 * agarro</b>: axe descarta los controles deshabilitados antes de medirlos, porque WCAG 1.4.3
 * exime explicitamente a los componentes de interfaz inactivos. Es decir que la pantalla que mas
 * falla contraste en la practica es exactamente la que ninguna herramienta automatica mira.
 *
 * <p>AKINE igual lo exige: un boton apagado que no se lee no comunica que la accion existe y
 * esta bloqueada, comunica que ahi no hay nada. Asi que lo mide este arnes, con la misma
 * aritmetica de WCAG y el mismo minimo, en vez de dar por bueno el silencio de axe.
 *
 * <p>Esto <b>no</b> es apagar ni relajar una regla: es cubrir lo que la regla declara fuera de
 * su alcance.
 */
export interface QueAxeNoMide {
  /** Selector de los elementos a medir a mano. Tiene que encontrar algo o el test falla. */
  readonly selector: string;
  /** Por que axe no lo mide. Obliga a escribirlo en el sitio de la llamada. */
  readonly porque: string;
}

/**
 * Una zona cuyo fondo axe no puede aplanar, y por lo tanto se mide de otra forma.
 *
 * <p><b>Esto NO es una exclusion.</b> `color-contrast` devuelve `incomplete` cuando en la pila de
 * fondos hay un `background-image` —un degrade cuenta— porque no puede promediar un gradiente
 * pixel a pixel. Apagar la regla ahi dejaria el texto sin medir, que es justo de lo que viene
 * esta etapa. Lo que se hace en cambio es medir ese texto <b>contra el primer fondo opaco de la
 * cadena de ancestros</b>, que es el color real sobre el que se lee en toda la superficie salvo
 * donde el degrade pinta. Se sigue exigiendo el mismo minimo de AA.
 *
 * <p><b>Lo que esa segunda medicion NO cubre, y hay que decirlo:</b> la franja donde el degrade
 * si pinta. Se declara como deuda en el `CLAUDE.md` del repo y en el registro de la etapa.
 */
export interface FondoConDegrade {
  /** Selector del contenedor cuyo `background-image` impide aplanar el fondo. */
  readonly selector: string;
  /** Por que ese contenedor lo tiene. Obliga a escribirlo en el sitio de la llamada. */
  readonly porque: string;
}

interface MedicionPropia {
  /** Por que la midio el arnes y no axe. Las dos causas no se pueden tapar entre si. */
  readonly origen: 'degrade' | 'fuera-del-alcance-de-axe';
  readonly selector: string;
  readonly ratio: number;
  readonly minimo: number;
  readonly color: string;
  readonly fondo: string;
}

/**
 * Corre axe y, para los nodos que hayan quedado sin veredicto dentro de `selectorConDegrade`,
 * mide el contraste a mano contra el primer fondo opaco de la cadena de ancestros.
 *
 * <p>La aritmetica es la de WCAG 2.1: luminancia relativa con la correccion de gamma sRGB, y el
 * minimo baja de 4,5 a 3 solo para texto grande -24 px, o 18,66 px en negrita-, que es
 * exactamente el umbral que aplica axe.
 */
async function correr(
  page: Page,
  selectorConDegrade: string | null,
  selectoresAMano: readonly string[],
): Promise<{ axe: CorridaDeAxe; medidos: MedicionPropia[]; vacios: string[] }> {
  return page.evaluate(
    async ([selector, aMano]: [string | null, readonly string[]]) => {
      const motor = (
        window as unknown as { axe: { run: (ctx: unknown, op: unknown) => Promise<unknown> } }
      ).axe;

      const resultado = (await motor.run(document, {
        // Solo la regla que esta etapa existe para medir. Las demas ya las cubre la suite de
        // jsdom, que SI puede decidirlas; correrlas de nuevo aca agregaria las reglas de pagina
        // completa (`region`, `landmark-one-main`) y convertiria un gate de contraste en una
        // auditoria de accesibilidad entera con otro alcance y otro dueno.
        runOnly: { type: 'rule', values: ['color-contrast'] },
        resultTypes: ['violations', 'incomplete', 'passes'],
      })) as {
        violations: { id: string; nodes: { target: string[]; html: string; any: unknown[] }[] }[];
        incomplete: { id: string; nodes: { target: string[]; html: string; any: unknown[] }[] }[];
        passes: { id: string; nodes: { target: string[] }[] }[];
      };

      function canales(color: string): [number, number, number, number] {
        const crudo = color.match(/[\d.]+/g) ?? ['0', '0', '0'];
        const [r, g, b, a] = crudo.map(Number);
        return [r, g, b, a === undefined ? 1 : a];
      }

      function luminancia([r, g, b]: [number, number, number, number]): number {
        const lineal = [r, g, b].map((canal) => {
          const v = canal / 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * lineal[0] + 0.7152 * lineal[1] + 0.0722 * lineal[2];
      }

      /** El primer ancestro con un `background-color` totalmente opaco. La pagina siempre lo es. */
      function fondoOpaco(desde: Element): string {
        let nodo: Element | null = desde;
        while (nodo !== null) {
          const color = getComputedStyle(nodo).backgroundColor;
          if (canales(color)[3] === 1) {
            return color;
          }
          nodo = nodo.parentElement;
        }
        return getComputedStyle(document.documentElement).backgroundColor;
      }

      const medidos: MedicionPropia[] = [];

      function medir(
        elemento: Element,
        comoSeLlama: string,
        origen: MedicionPropia['origen'],
      ): MedicionPropia {
        const estilo = getComputedStyle(elemento);
        const px = Number.parseFloat(estilo.fontSize);
        const negrita = Number.parseInt(estilo.fontWeight, 10) >= 700;
        const fondo = fondoOpaco(elemento);
        const texto = luminancia(canales(estilo.color));
        const superficie = luminancia(canales(fondo));

        return {
          origen,
          selector: comoSeLlama,
          ratio: (Math.max(texto, superficie) + 0.05) / (Math.min(texto, superficie) + 0.05),
          // El umbral de WCAG para texto grande: 24 px, o 18,66 px en negrita. Es el mismo que
          // aplica axe, para que las dos mediciones exijan lo mismo.
          minimo: px >= 24 || (negrita && px >= 18.66) ? 3 : 4.5,
          color: estilo.color,
          fondo,
        };
      }

      // Lo que axe declara fuera de su alcance -hoy, los controles deshabilitados-.
      const vacios: string[] = [];
      for (const aMedir of aMano) {
        const elementos = [...document.querySelectorAll(aMedir)];
        if (elementos.length === 0) {
          vacios.push(aMedir);
          continue;
        }
        for (const elemento of elementos) {
          medidos.push(medir(elemento, aMedir, 'fuera-del-alcance-de-axe'));
        }
      }

      if (selector !== null) {
        const pendientes = resultado.incomplete.flatMap((regla) => regla.nodes);
        const sobreviven: typeof pendientes = [];

        for (const nodo of pendientes) {
          const elemento = document.querySelector(nodo.target.join(' '));
          if (elemento === null || elemento.closest(selector) === null) {
            sobreviven.push(nodo);
            continue;
          }

          medidos.push(medir(elemento, nodo.target.join(' '), 'degrade'));
        }

        resultado.incomplete =
          sobreviven.length > 0 ? [{ ...resultado.incomplete[0], nodes: sobreviven }] : [];
      }

      return { axe: resultado as unknown as CorridaDeAxe, medidos, vacios };
    },
    [selectorConDegrade, selectoresAMano] as [string | null, readonly string[]],
  );
}

/** Una linea por nodo, con el ratio medido y el minimo exigido: el reporte tiene que bastar. */
function detallar(resultados: readonly ResultadoDeAxe[], rotulo: string): string[] {
  return resultados.flatMap((resultado) =>
    resultado.nodes.map((nodo) => {
      const datos = nodo.any.find((chequeo) => chequeo.id === 'color-contrast')?.data;
      const medido =
        datos?.contrastRatio === undefined ? '?' : `${datos.contrastRatio.toFixed(2)}:1`;
      const exigido = datos?.expectedContrastRatio ?? `${NIVEL}`;
      const colores =
        datos?.fgColor === undefined
          ? ''
          : ` (texto ${datos.fgColor} sobre fondo ${datos.bgColor})`;
      return (
        `  [${rotulo}] ${nodo.target.join(' ')} -> medido ${medido}, exigido ${exigido}${colores}\n` +
        `      ${nodo.html.slice(0, 160)}`
      );
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Fixtures sinteticos
// ---------------------------------------------------------------------------------------------

/**
 * Los cinco espacios de la sede, elegidos para que la tabla dibuje <b>todas</b> sus variantes en
 * una sola pantalla: una fila vigente, una activa todavia sin servicio, una con vigencia vencida
 * y una dada de baja —que se pinta con `.fila--revocada` y `.marca-estado--revocada`—.
 *
 * <p>Son los mismos datos que `scripts/api-simulada.mjs` usa para mirar la pantalla a mano.
 */
const ESPACIO_BASE = {
  id: 10,
  organizationId: ORGANIZATION_ID,
  consultorioId: CONSULTORIO_ID,
  name: 'Box 1',
  tipo: 'BOX',
  capacidad: 1,
  notes: 'Camilla electrica, entrada por el pasillo',
  validFrom: '2026-01-05T12:00:00Z',
  validUntil: null as string | null,
  estado: 'ACTIVO',
  enServicio: true,
  deletedAt: null as string | null,
  deactivationReason: null as string | null,
  version: 2,
};

const ESPACIOS = [
  ESPACIO_BASE,
  {
    ...ESPACIO_BASE,
    id: 11,
    name: 'Box 4 (ala nueva)',
    notes: null,
    validFrom: '2026-10-01T03:00:00Z',
    enServicio: false,
    version: 1,
  },
  {
    ...ESPACIO_BASE,
    id: 12,
    name: 'Gimnasio planta baja',
    tipo: 'GIMNASIO',
    capacidad: 8,
    notes: 'Colchonetas, espalderas y dos bicicletas',
    validUntil: '2027-03-01T03:00:00Z',
    version: 5,
  },
  {
    ...ESPACIO_BASE,
    id: 13,
    name: 'Pileta',
    tipo: 'PILETA',
    capacidad: 6,
    notes: null,
    validFrom: '2025-11-01T03:00:00Z',
    validUntil: '2026-04-01T03:00:00Z',
    enServicio: false,
    version: 3,
  },
  {
    ...ESPACIO_BASE,
    id: 14,
    name: 'Sala grupal chica',
    tipo: 'SALA_GRUPAL',
    capacidad: 4,
    notes: null,
    estado: 'INACTIVO',
    enServicio: false,
    deletedAt: '2026-06-20T14:30:00Z',
    deactivationReason: 'Se unifico con el gimnasio en la refaccion de junio',
    version: 4,
  },
];

/** Padron minimo: alguien que NO es paciente y alguien que si, que es la distincion de M07. */
const PERSONAS = [
  {
    id: 40,
    tipoDocumento: 'DNI',
    numeroDocumento: '30.111.222',
    apellido: 'Perez',
    nombre: 'Ana Maria',
    fechaNacimiento: '1985-03-14',
    email: 'ana.perez@example.com',
    telefono: '+54 11 5555-0000',
    esPaciente: false,
    estado: 'ACTIVO',
    version: 0,
  },
  {
    id: 41,
    tipoDocumento: 'DNI',
    numeroDocumento: '28444555',
    apellido: 'Gomez Iriarte',
    nombre: 'Luis Alberto',
    telefono: '3514445566',
    esPaciente: true,
    perfilPacienteId: 7,
    perfilActivadoEn: '2026-08-20T13:00:00Z',
    estado: 'ACTIVO',
    version: 3,
  },
];

function pagina(contenido: readonly unknown[]): unknown {
  return { content: contenido, page: 0, size: 20, totalElements: contenido.length, totalPages: 1 };
}

// ---------------------------------------------------------------------------------------------
// El router
// ---------------------------------------------------------------------------------------------

/** Como responde el padron: con filas, vacio, o con un error de servidor. */
export type ModoPadron = 'con-filas' | 'vacio' | 'error';

export interface ApiDeContraste {
  /** Se cambia antes de navegar para forzar el estado vacio o el de error de la pantalla. */
  padron: ModoPadron;
}

/**
 * Instala la API simulada y deja la sesion ACTIVA con contexto.
 *
 * <p>La sesion se resuelve por el camino real: `provideAppInitializer` pide `POST /auth/refresh`
 * y un token con `scope: context` es lo que hace que `authGuard` y `contextGuard` dejen pasar.
 * No se inyecta nada en ningun store: un atajo por dentro dejaria el shell —y con el la barra de
 * navegacion, que es una de las superficies que hay que medir— sin pintar.
 */
export async function instalarApiDeContraste(page: Page): Promise<ApiDeContraste> {
  const api: ApiDeContraste = { padron: 'con-filas' };

  await page.route('**/api/v1/**', async (ruta: Route) => {
    const peticion: Request = ruta.request();
    const url = new URL(peticion.url());
    const camino = url.pathname;
    const metodo = peticion.method();

    const json = (cuerpo: unknown, status = 200): Promise<void> =>
      ruta.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) });

    const problema = (status: number, tipo: string, detail: string): Promise<void> =>
      ruta.fulfill({
        status,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: `https://akine.app/problems/${tipo}`,
          title: tipo,
          status,
          detail,
        }),
      });

    // --- Sesion y contexto -------------------------------------------------------------
    if (camino === '/api/v1/auth/refresh' || camino === '/api/v1/auth/context') {
      return json({
        accessToken: 'token-sintetico-de-contraste',
        scope: 'context',
        organizationId: ORGANIZATION_ID,
        consultorioId: CONSULTORIO_ID,
      });
    }

    if (camino === '/api/v1/me/contexts') {
      return json([
        {
          organizationId: ORGANIZATION_ID,
          organizationName: 'Centro Kine Belgrano',
          consultorioId: CONSULTORIO_ID,
          consultorioName: 'Sede Centro',
        },
      ]);
    }

    if (camino === '/api/v1/me/permissions') {
      // Con permisos de gestion la tabla dibuja su celda de acciones, que es donde viven los
      // botones chicos y —en las filas dadas de baja— los botones deshabilitados.
      return json({
        permissions: [
          'tenant:read',
          'consultorio:manage',
          'paciente:manage',
          'paciente:read',
          'turno:read',
        ],
      });
    }

    // --- Espacios ----------------------------------------------------------------------
    if (camino.endsWith('/espacios') && metodo === 'GET') {
      const filtro = url.searchParams.get('estado') ?? 'ACTIVO';
      const filas =
        filtro === 'TODOS' ? ESPACIOS : ESPACIOS.filter((espacio) => espacio.estado === filtro);
      return json(pagina(filas));
    }

    // --- Padron ------------------------------------------------------------------------
    if (camino === '/api/v1/personas' && metodo === 'GET') {
      if (api.padron === 'error') {
        return problema(500, 'internal-error', 'No pudimos leer el padron. Volve a intentar.');
      }
      return json(pagina(api.padron === 'vacio' ? [] : PERSONAS));
    }

    // Un endpoint sin stub ROMPE la auditoria en vez de devolver algo plausible: si la pantalla
    // empieza a pedir algo nuevo, el 501 lo delata.
    return problema(501, 'not-implemented', `El arnes de contraste no simula ${metodo} ${camino}`);
  });

  return api;
}
