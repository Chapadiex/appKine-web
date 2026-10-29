import { createRequire } from 'node:module';
import { join } from 'node:path';

import { Page, Request, Route, expect } from '@playwright/test';

/**
 * Arnes de la auditoria de CONTRASTE DE COLOR (WCAG 1.4.3 y 1.4.11, nivel AA), y de la ETIQUETA EN
 * EL NOMBRE (WCAG 2.5.3, nivel A): la otra regla que jsdom no puede decidir. Ver
 * {@link auditarEtiquetaEnElNombre}.
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
 *   <li><b>La regla no pudo decidir</b> (`incomplete`). No se tolera en silencio: rompe el
 *       test. Hasta el 12/10/2026 caian aca las celdas de `.tabla-scroll` —la sombra de
 *       desborde era un `background-image`, que axe no aplana— y el arnes las media a mano contra
 *       el primer fondo opaco. El indicador paso al borde del contenedor y axe las mide solo.</li>
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
    readonly queAxeNoMide?: readonly QueAxeNoMide[];
  } = {},
): Promise<void> {
  await page.addScriptTag({ path: RUTA_AXE });

  const aMano = (opciones.queAxeNoMide ?? []).map((zona) => zona.selector);
  const { axe: resultado, medidos, vacios } = await correr(page, aMano);

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

  await auditarEtiquetaEnElNombre(page, donde);
}

/**
 * La otra regla que jsdom no puede decidir: WCAG 2.5.3, <b>Etiqueta en el nombre</b> (nivel A).
 *
 * <p>Si un control muestra un texto, su nombre accesible tiene que contenerlo: quien maneja la
 * pantalla por voz dice "clic en Guardar" porque eso es lo que ve, y si el `aria-label` dice otra
 * cosa el comando no encuentra el boton. axe-core la activa bajo `wcag21a` desde 4.14, pero para
 * saber que caracteres del texto son visibles dibuja en un `canvas`, y jsdom no lo implementa: en
 * la suite unitaria termina siempre en `incomplete`. El arnes de jsdom la declara en
 * `REGLAS_SIN_VEREDICTO_EN_JSDOM` remitiendo a este lugar, y esta funcion es lo que vuelve cierta
 * esa remision.
 *
 * <p>Vive dentro de `auditarContraste` y no en un spec propio porque necesita exactamente lo mismo
 * -Chromium real, pantallas pintadas en sus estados mas cargados, los dos temas- y porque asi
 * ningun escenario de contraste puede olvidarse de medirla. Corre en una pasada aparte de
 * `color-contrast` para no mezclar sus `passes` con el conteo de pares de color medidos.
 *
 * <p>Se exige cero violaciones <b>y</b> cero `incomplete`, el mismo criterio que con el contraste.
 * No se exige que haya nodos aplicables: una pantalla sin controles con `aria-label` no tiene nada
 * que comparar, y eso es un resultado legitimo, no una medicion vacia.
 */
async function auditarEtiquetaEnElNombre(page: Page, donde: string): Promise<void> {
  const resultado = await page.evaluate(async () => {
    const motor = (
      window as unknown as { axe: { run: (ctx: unknown, op: unknown) => Promise<unknown> } }
    ).axe;
    return (await motor.run(document, {
      runOnly: { type: 'rule', values: ['label-content-name-mismatch'] },
      resultTypes: ['violations', 'incomplete'],
    })) as {
      violations: { nodes: { target: string[]; html: string }[] }[];
      incomplete: { nodes: { target: string[]; html: string }[] }[];
    };
  });

  const nodos = (resultados: typeof resultado.violations, rotulo: string): string[] =>
    resultados.flatMap((regla) =>
      regla.nodes.map((nodo) => `  [${rotulo}] ${nodo.target.join(' ')}\n      ${nodo.html}`),
    );
  const fallos = [
    ...nodos(resultado.violations, 'VIOLACION'),
    ...nodos(resultado.incomplete, 'SIN MEDIR'),
  ];

  expect(
    fallos,
    `WCAG 2.5.3 (etiqueta en el nombre) en ${donde}:\n${fallos.join('\n')}\n` +
      'El nombre accesible de un control (`aria-label`, `aria-labelledby`) tiene que contener ' +
      'su texto visible.',
  ).toEqual([]);
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

interface MedicionPropia {
  readonly selector: string;
  readonly ratio: number;
  readonly minimo: number;
  readonly color: string;
  readonly fondo: string;
}

/**
 * Corre axe y mide a mano, contra el primer fondo opaco de la cadena de ancestros, lo que axe
 * declara fuera de su alcance.
 *
 * <p>La aritmetica es la de WCAG 2.1: luminancia relativa con la correccion de gamma sRGB, y el
 * minimo baja de 4,5 a 3 solo para texto grande -24 px, o 18,66 px en negrita-, que es
 * exactamente el umbral que aplica axe.
 */
async function correr(
  page: Page,
  selectoresAMano: readonly string[],
): Promise<{ axe: CorridaDeAxe; medidos: MedicionPropia[]; vacios: string[] }> {
  return page.evaluate(async (aMano: readonly string[]) => {
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

    function medir(elemento: Element, comoSeLlama: string): MedicionPropia {
      const estilo = getComputedStyle(elemento);
      const px = Number.parseFloat(estilo.fontSize);
      const negrita = Number.parseInt(estilo.fontWeight, 10) >= 700;
      const fondo = fondoOpaco(elemento);
      const texto = luminancia(canales(estilo.color));
      const superficie = luminancia(canales(fondo));

      return {
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
        medidos.push(medir(elemento, aMedir));
      }
    }

    // Texto dentro de la capa superior -un `dialog` modal abierto (el panel lateral, UX-11) o el
    // `popover` de los avisos globales (UX-12)-: axe no resuelve el apilado de esa capa y devuelve `incomplete` (`elmPartiallyObscuring` o `bgOverlap`)
    // para algunos nodos,
    // aunque `elementsFromPoint` del navegador muestra que nada los tapa. No se toleran: se miden
    // con la misma aritmetica contra el primer fondo opaco, que dentro del panel es el suyo.
    for (const regla of resultado.incomplete) {
      regla.nodes = regla.nodes.filter((nodo) => {
        const datos = (nodo.any as { data?: { messageKey?: string } }[])[0]?.data;
        const elemento = document.querySelector(nodo.target[0] ?? '');
        const tapado = ['bgOverlap', 'elmPartiallyObscuring'].includes(datos?.messageKey ?? '');
        if (!tapado || elemento?.closest('dialog[open], [popover]:popover-open') == null) {
          return true;
        }
        medidos.push(medir(elemento, `capa superior ${nodo.target.join(' ')}`));
        return false;
      });
    }
    resultado.incomplete = resultado.incomplete.filter((regla) => regla.nodes.length > 0);

    return { axe: resultado as unknown as CorridaDeAxe, medidos, vacios };
  }, selectoresAMano);
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

/** Una clase llena con una persona en espera: el estado con mas marcas de la pantalla. */
export const CLASE = {
  id: 70,
  ofertaId: 42,
  ofertaNombre: 'Pilates reformer',
  profesionalNombre: 'Lic. Diaz',
  espacioId: 9,
  espacioNombre: 'Sala grande',
  profesionalId: 55,
  estado: 'PROGRAMADA',
  inicio: '2026-10-20T21:00:00Z',
  fin: '2026-10-20T22:00:00Z',
  capacidad: 2,
  capacidadEfectiva: 2,
  ocupados: 2,
  version: 0,
} as const;

const PARTICIPANTES_DE_CLASE = [
  {
    nombre: 'Ana',
    apellido: 'Perez',
    tipoDocumento: 'DNI',
    numeroDocumento: '30111222',
    inscripcion: { id: 501, estado: 'RESERVADA' },
  },
  { nombre: 'Luis', apellido: 'Gomez', inscripcion: { id: 502, estado: 'CONFIRMADA' } },
  {
    nombre: 'Eva',
    apellido: 'Sosa',
    inscripcion: { id: 503, estado: 'LISTA_ESPERA', posicionEspera: 1 },
  },
];

/** La clase de la grilla del dia (agenda unificada), para la lista de la asistencia. */
const EVENTO_DE_CLASE = {
  tipo: 'CLASE',
  eventoId: CLASE.id,
  titulo: 'Pilates reformer',
  ofertaId: CLASE.ofertaId,
  ofertaNombre: CLASE.ofertaNombre,
  estado: 'EN_CURSO',
  inicio: CLASE.inicio,
  fin: CLASE.fin,
  capacidad: 2,
  ocupados: 2,
};

/** La clase EN CURSO para tomar lista: una sin marcar, una corregida, una en espera. */
const DETALLE_OPERATIVO = {
  claseId: CLASE.id,
  titulo: 'Pilates reformer',
  estado: 'EN_CURSO',
  inicio: CLASE.inicio,
  fin: CLASE.fin,
  presentes: 1,
  ausentes: 0,
  sinResolver: 1,
  ocupados: 2,
  capacidadEfectiva: 2,
  enEspera: 1,
  page: 0,
  totalPages: 1,
  content: [
    PARTICIPANTES_DE_CLASE[0],
    {
      ...PARTICIPANTES_DE_CLASE[1],
      asistencia: { id: 20, resultado: 'PRESENTE', correcciones: 1 },
    },
    PARTICIPANTES_DE_CLASE[2],
  ],
};

/** El lote de asistencia con las tres salidas que pinta la pantalla: guardado, pase y fallo. */
const LOTE_DE_ASISTENCIA = {
  exitosos: 1,
  fallidos: 1,
  items: [
    {
      inscripcionId: 501,
      resultado: { registrada: true, consumoDeCredito: { efecto: 'CONSUMIDO', saldo: 3 } },
    },
    {
      inscripcionId: 502,
      problemType: 'https://akine.app/problems/inscripcion-transicion-no-permitida',
      detalle: 'La inscripcion esta cancelada',
    },
  ],
};

/** El panel de atencion clinica de la clase (AKINE-08.05). */
const ATENCION_GRUPAL = {
  claseId: CLASE.id,
  clinica: true,
  participantes: [
    {
      inscripcionId: 501,
      nombre: 'Ana',
      apellido: 'Perez',
      estuvo: true,
      resultadoAsistencia: 'PRESENTE',
    },
    {
      inscripcionId: 502,
      nombre: 'Luis',
      apellido: 'Gomez',
      estuvo: true,
      resultadoAsistencia: 'PRESENTE_TARDE',
      atenciones: [
        { sesionId: 901, derivacionId: 31, estado: 'CERRADA', numeroEnCaso: 3, numeroSesion: 8 },
      ],
    },
    {
      inscripcionId: 503,
      nombre: 'Eva',
      apellido: 'Sosa',
      estuvo: false,
      resultadoAsistencia: 'AUSENTE',
    },
  ],
};

/** Como responde el padron: con filas, vacio, o con un error de servidor. */
/** Productos de pack (M29): uno vigente y uno dado de baja, que pinta la fila atenuada. */
const PRODUCTOS_DE_PACK = [
  {
    id: 9,
    ofertaId: CLASE.ofertaId,
    nombre: 'Pack Pilates 8',
    creditos: 8,
    precio: 40000,
    moneda: 'ARS',
    vigenciaDias: 60,
    vigenciaDesde: '2026-10-01',
    active: true,
  },
  {
    id: 8,
    ofertaId: CLASE.ofertaId,
    nombre: 'Pack Pilates 4',
    creditos: 4,
    precio: 22000,
    moneda: 'ARS',
    vigenciaDias: 30,
    vigenciaDesde: '2026-01-01',
    vigenciaHasta: '2026-09-30',
    active: false,
    deactivationReason: 'Se discontinua',
  },
];

export const PERSONA_CON_PASES = 512;

/**
 * Los pases de una persona con las tres marcas de estado —activo, agotado y vencido (el que escribe
 * el job desde 08.07)— y uno anulado, que pinta la fila atenuada con el motivo.
 */
const PASES_DE_PERSONA = [
  { estado: 'ACTIVO', vigente: true, creditosDisponibles: 5, id: 77 },
  { estado: 'AGOTADO', vigente: true, creditosDisponibles: 0, id: 76 },
  { estado: 'VENCIDO', vigente: false, creditosDisponibles: 0, id: 75 },
  {
    estado: 'ANULADO',
    vigente: false,
    creditosDisponibles: 0,
    id: 74,
    anuladoEn: '2026-08-02T13:00:00Z',
    motivoAnulacion: 'Vendido por error',
  },
].map((pase) => ({
  ...pase,
  nombre: 'Pack Pilates 8',
  creditosIniciales: 8,
  vigenciaDesde: '2026-08-01',
  vigenciaHasta: '2026-11-29',
  precio: 40000,
  moneda: 'ARS',
  vendidoEn: '2026-08-01T13:00:00Z',
}));

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
/** Tarifas de honorario de la oferta de la clase (DP-38): una vigente y una dada de baja. */
const HONORARIOS_DE_LA_OFERTA = [
  {
    id: 700,
    ofertaId: CLASE.ofertaId,
    importePorParticipante: 1500,
    moneda: 'ARS',
    vigenciaDesde: '2026-01-01',
    estado: 'ACTIVO',
    vigente: true,
    version: 2,
  },
  {
    id: 699,
    ofertaId: CLASE.ofertaId,
    importePorParticipante: 1200,
    moneda: 'ARS',
    vigenciaDesde: '2025-01-01',
    vigenciaHasta: '2025-12-31',
    estado: 'INACTIVO',
    vigente: false,
    deactivationReason: 'Cargada con el importe del ano anterior por error',
    version: 3,
  },
];

/** Un borrador de honorarios que mezcla dos servicios, con clases excluidas por cada motivo. */
const BORRADOR_DE_HONORARIOS = {
  consultorioId: CONSULTORIO_ID,
  colaboradorMembershipId: 55,
  desde: '2026-10-01',
  hasta: '2026-10-31',
  importeTotal: 1234567.5,
  moneda: 'ARS',
  clases: [
    {
      claseId: 70,
      fecha: '2026-10-20',
      titulo: 'Pilates reformer de los martes a la tarde',
      ofertaId: CLASE.ofertaId,
      ofertaNombre: 'Pilates reformer',
      presentes: 12,
      importePorParticipante: 1500,
      importeClase: 18000,
      instructores: 2,
      posicion: 1,
      importeColaborador: 9000,
      moneda: 'ARS',
    },
    {
      claseId: 72,
      fecha: '2026-10-22',
      titulo: 'Yoga terapeutico',
      ofertaId: 43,
      ofertaNombre: 'Yoga terapeutico para adultos mayores',
      presentes: 8,
      importePorParticipante: 1225567.5,
      importeClase: 1225567.5,
      instructores: 1,
      posicion: 1,
      importeColaborador: 1225567.5,
      moneda: 'ARS',
    },
  ],
  excluidas: [
    {
      claseId: 69,
      fecha: '2026-10-13',
      titulo: 'Pilates reformer',
      ofertaNombre: 'Pilates reformer',
      motivo: 'YA_LIQUIDADA',
      egresoId: 600,
    },
    { claseId: 68, fecha: '2026-10-06', ofertaNombre: 'Pilates reformer', motivo: 'SIN_PRESENTES' },
    { claseId: 67, fecha: '2026-10-02', ofertaNombre: 'Funcional', motivo: 'SIN_HONORARIO' },
  ],
};

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

    // La zona de la sede: `contextGuard` la pide (sin esperarla) al abrir cualquier pantalla del tenant.
    if (camino === `/api/v1/organizations/${ORGANIZATION_ID}/consultorios`) {
      return json({ content: [{ id: CONSULTORIO_ID, timezone: 'America/Argentina/Cordoba' }] });
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
          'clase:read',
          'clase:manage',
          'inscripcion:read',
          'inscripcion:manage',
          'asistencia:manage',
          'producto:read',
          'producto:manage',
          'pase:read',
          'pase:manage',
          'pase:adjust',
          'sesion:register',
          'hc:write',
          'caja:operate',
        ],
      });
    }

    // --- Clases grupales (F9) ----------------------------------------------------------
    const clases = `/api/v1/consultorios/${CONSULTORIO_ID}/clases`;
    if (camino === clases && metodo === 'GET') {
      return json([CLASE, { ...CLASE, id: 71, titulo: 'Yoga suave', estado: 'CANCELADA' }]);
    }
    if (camino === `${clases}/${CLASE.id}` && metodo === 'GET') {
      return json(CLASE);
    }
    if (camino === `${clases}/${CLASE.id}/cupos`) {
      return json({
        claseId: CLASE.id,
        capacidad: 2,
        capacidadEfectiva: 2,
        ocupados: 2,
        disponibles: 0,
        enEspera: 1,
      });
    }
    if (camino === `${clases}/${CLASE.id}/historial`) {
      return json([{ id: 1, tipo: 'CREACION', ocurridoEn: '2026-10-14T13:00:00Z' }]);
    }
    if (camino === `${clases}/${CLASE.id}/inscripciones` && metodo === 'GET') {
      return json(PARTICIPANTES_DE_CLASE);
    }
    // Atencion clinica de la clase (AKINE-08.05): una sin atencion, una cerrada y una ausente.
    if (camino === `${clases}/${CLASE.id}/atencion-clinica` && metodo === 'GET') {
      return json(ATENCION_GRUPAL);
    }
    // Asistencia (08.03): la clase EN CURSO, con una asistencia ya registrada y corregida.
    if (camino === `${clases}/${CLASE.id}/detalle-operativo`) {
      return json(DETALLE_OPERATIVO);
    }
    // El lote de asistencia: uno guardado con consumo de pase y uno rechazado con su causa.
    if (camino === `${clases}/${CLASE.id}/asistencias/lote` && metodo === 'POST') {
      return json(LOTE_DE_ASISTENCIA);
    }
    // El lote de atencion clinica (08.05): Ana no tiene derivacion vigente.
    if (camino === `${clases}/${CLASE.id}/atencion-clinica/lote` && metodo === 'POST') {
      return json({
        exitosos: 0,
        fallidos: 1,
        items: [
          {
            inscripcionId: 501,
            problemType: 'https://akine.app/problems/participacion-sin-derivacion',
            detalle: 'Sin derivacion vigente',
          },
        ],
      });
    }
    // Las clases del dia de la asistencia salen de la agenda unificada.
    if (camino === `/api/v1/consultorios/${CONSULTORIO_ID}/agenda` && metodo === 'GET') {
      return json({
        fecha: '2026-10-20',
        timezone: 'America/Argentina/Cordoba',
        eventos: [
          { ...EVENTO_DE_CLASE },
          { ...EVENTO_DE_CLASE, eventoId: 71, titulo: 'Yoga suave', estado: 'CANCELADA' },
        ],
      });
    }
    // Derivar a Ana (AKINE-08.04): derivable, paciente, con dos casos activos y uno cerrado.
    if (camino === `${clases}/${CLASE.id}/inscripciones/501/elegibilidad-clinica`) {
      return json({
        inscripcionId: 501,
        personaId: 601,
        derivable: true,
        ofertaClinica: true,
        esPacienteVigente: true,
        resultadoAsistencia: 'PRESENTE',
        motivos: [],
      });
    }
    if (camino === '/api/v1/historias-clinicas/por-persona/601/datos-administrativos') {
      return json({
        personaId: 601,
        tieneHistoriaClinica: true,
        casos: [
          {
            id: 7,
            numeroCaso: 2,
            estado: 'ACTIVO',
            ofertaId: CLASE.ofertaId,
            abiertoEn: '2026-10-01T13:00:00Z',
          },
          {
            id: 6,
            numeroCaso: 1,
            estado: 'ACTIVO',
            ofertaId: 999,
            abiertoEn: '2026-09-01T13:00:00Z',
          },
          { id: 5, numeroCaso: 3, estado: 'CERRADO', ofertaId: 999 },
        ],
      });
    }
    if (camino === `${clases}/${CLASE.id}/inscripciones/501/derivaciones`) {
      return json({
        derivaciones: [
          {
            id: 30,
            casoClinicoId: 7,
            numeroCaso: 2,
            estado: 'VIGENTE',
            derivadaEn: '2026-10-20T21:05:00Z',
          },
          {
            id: 29,
            casoClinicoId: 6,
            numeroCaso: 1,
            estado: 'REVERTIDA',
            motivoReversion: 'Derivada al caso equivocado',
          },
        ],
      });
    }
    if (camino === `/api/v1/consultorios/${CONSULTORIO_ID}/ofertas` && metodo === 'GET') {
      return json([
        { id: CLASE.ofertaId, nombreComercial: 'Pilates reformer', modalidad: 'GRUPAL' },
      ]);
    }
    if (
      camino === `/api/v1/consultorios/${CONSULTORIO_ID}/ofertas/${CLASE.ofertaId}/habilitaciones`
    ) {
      return json({ profesionales: [{ membershipId: 55, nombre: 'Lic. Diaz' }] });
    }

    // --- Honorarios por clase (DP-38) --------------------------------------------------
    if (camino === `${clases}/${CLASE.id}/instructores` && metodo === 'GET') {
      return json({
        claseId: CLASE.id,
        principalMembershipId: 55,
        principalNombre: 'Lic. Diaz',
        adicionales: [{ membershipId: 61, nombre: 'Lic. Rios Altamirano' }],
      });
    }
    if (
      camino ===
        `/api/v1/consultorios/${CONSULTORIO_ID}/ofertas/${CLASE.ofertaId}/honorarios-por-clase` &&
      metodo === 'GET'
    ) {
      return json(HONORARIOS_DE_LA_OFERTA);
    }
    if (camino === `/api/v1/organizations/${ORGANIZATION_ID}/memberships` && metodo === 'GET') {
      return json(
        pagina([
          { id: 55, accountName: 'Lic. Diaz', estado: 'ACTIVA', roleCode: 'PROFESIONAL' },
          {
            id: 61,
            accountName: 'Lic. Rios Altamirano',
            estado: 'ACTIVA',
            roleCode: 'PROFESIONAL',
          },
        ]),
      );
    }
    if (camino === `/api/v1/consultorios/${CONSULTORIO_ID}/honorarios/borrador`) {
      return json(BORRADOR_DE_HONORARIOS);
    }

    // --- Productos de pack y pases (F9, M29) -------------------------------------------
    if (camino === `/api/v1/consultorios/${CONSULTORIO_ID}/productos` && metodo === 'GET') {
      return json(PRODUCTOS_DE_PACK);
    }
    if (camino === `/api/v1/consultorios/${CONSULTORIO_ID}/personas/${PERSONA_CON_PASES}/pases`) {
      return json(PASES_DE_PERSONA);
    }
    if (camino === `/api/v1/personas/${PERSONA_CON_PASES}`) {
      return json({ id: PERSONA_CON_PASES, apellido: 'Sosa', nombre: 'Eva' });
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

/** Pide el borrador de honorarios del arnes: elige al colaborador y calcula. */
export async function abrirBorradorDeHonorarios(page: Page): Promise<void> {
  const colaborador = page.getByLabel('Colaborador');
  await colaborador.locator('option').nth(1).waitFor({ state: 'attached' });
  await colaborador.selectOption({ label: 'Lic. Diaz' });
  await page.getByRole('button', { name: 'Calcular el borrador' }).click();
  await page.getByText('Ya liquidada a este colaborador').waitFor();
}
