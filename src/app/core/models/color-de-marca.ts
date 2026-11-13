/**
 * Aritmetica de color de la marca del centro (colores institucionales por organizacion).
 *
 * <p>Todo trabaja con `#rrggbb`. El contraste es el de WCAG 2.1: sirve para elegir el texto que
 * va sobre el color del centro y para avisar cuando un color no se va a leer. Avisar, no impedir:
 * el centro elige libre.
 */

export type TemaDeMarca = 'claro' | 'oscuro';

/** Las zonas de la pantalla a las que un centro puede fijarles color, ademas de los dos de marca. */
export type ZonaDeMarca =
  'barraLateral' | 'cabecera' | 'fondo' | 'tarjeta' | 'pie' | 'botonSecundario';

export type CampoDeMarca = 'principal' | 'acento' | ZonaDeMarca;

export const ZONAS_DE_MARCA: readonly ZonaDeMarca[] = [
  'barraLateral',
  'cabecera',
  'fondo',
  'tarjeta',
  'pie',
  'botonSecundario',
];

/**
 * Los colores que un centro elige por tema. En principal y acento, `null` es "el de AKINE"; en
 * una zona, `null` o ausente es "automatico": se deriva del color principal.
 */
export type ColoresDeTema = {
  readonly principal: string | null;
  readonly acento: string | null;
} & Readonly<Partial<Record<ZonaDeMarca, string | null>>>;

/** Las cuatro zonas tal como llegan del servidor, con `null` en lo que el centro no fijo. */
export function zonasDe(
  interfaz: Readonly<Partial<Record<ZonaDeMarca, string>>> | undefined,
): Record<ZonaDeMarca, string | null> {
  return {
    barraLateral: interfaz?.barraLateral ?? null,
    cabecera: interfaz?.cabecera ?? null,
    fondo: interfaz?.fondo ?? null,
    tarjeta: interfaz?.tarjeta ?? null,
    pie: interfaz?.pie ?? null,
    botonSecundario: interfaz?.botonSecundario ?? null,
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Superficie de tarjeta y texto de cada tema, para medir contraste. Son los mismos valores que
 * `--ref-*` de `design-system.css`: un cambio alla va tambien aca.
 */
export const REFERENCIA_DE_TEMA: Readonly<
  Record<
    TemaDeMarca,
    {
      readonly superficie: string;
      readonly texto: string;
      readonly fondo: string;
      readonly bordeDeControl: string;
    }
  >
> = {
  claro: { superficie: '#ffffff', texto: '#182230', fondo: '#f4f6f9', bordeDeControl: '#808a99' },
  oscuro: { superficie: '#1d2a36', texto: '#f1f5f9', fondo: '#101820', bordeDeControl: '#8494a3' },
};

/** Porcentaje del color principal que lleva el tinte automatico de cada zona. */
const TINTE = { barraLateral: 12, cabecera: 7 } as const;

/**
 * Los colores por defecto (`--color-accion-fondo` y `--color-acento` de cada tema): lo que se ve
 * mientras el centro no eligio el suyo, y el punto de partida al empezar a editar.
 */
export const COLORES_DE_AKINE: Readonly<
  Record<TemaDeMarca, { principal: string; acento: string }>
> = {
  claro: { principal: '#2563eb', acento: '#1d4ed8' },
  oscuro: { principal: '#60a5fa', acento: '#93c5fd' },
};

/** Los dos textos que pueden ir sobre un boton pintado con el color del centro. */
const TEXTO_SOBRE_COLOR = { claro: '#ffffff', oscuro: '#101820' } as const;

export function esColor(valor: string | null | undefined): valor is string {
  return typeof valor === 'string' && HEX.test(valor);
}

function canales(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function aHex(rgb: readonly number[]): string {
  return (
    '#' +
    rgb
      .map((c) =>
        Math.round(Math.min(255, Math.max(0, c)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** Luminancia relativa (WCAG). */
export function luminancia(hex: string): number {
  const [r, g, b] = canales(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razon de contraste entre dos colores, de 1 a 21. */
export function contraste(a: string, b: string): number {
  const [clara, oscura] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (clara + 0.05) / (oscura + 0.05);
}

/** De los dos textos posibles (blanco o casi negro), el que mejor se lee sobre `fondo`. */
export function textoSobre(fondo: string): string {
  const { claro, oscuro } = TEXTO_SOBRE_COLOR;
  return contraste(fondo, claro) >= contraste(fondo, oscuro) ? claro : oscuro;
}

/** Mezcla `hex` con `con`: `proporcion` 0 deja `hex`, 1 da `con`. */
export function mezclar(hex: string, con: string, proporcion: number): string {
  const a = canales(hex);
  const b = canales(con);
  return aHex(a.map((c, i) => c + (b[i] - c) * proporcion));
}

/** "Mas fuerte" (`paso` > 0) oscurece; "mas suave" (`paso` < 0) aclara. */
export function ajustarIntensidad(hex: string, paso: number): string {
  return mezclar(hex, paso > 0 ? '#000000' : '#ffffff', Math.min(1, Math.abs(paso)));
}

/**
 * El tono mas cercano a `hex` que llega a `minimo` de contraste contra `fondo`: se aleja del fondo
 * de a poco (oscurece sobre fondo claro, aclara sobre fondo oscuro). Si ya llega, devuelve `hex`.
 */
export function tonoConContraste(hex: string, fondo: string, minimo: number): string {
  const hacia = luminancia(fondo) > 0.5 ? '#000000' : '#ffffff';
  let tono = hex;
  for (let paso = 1; paso <= 20 && contraste(tono, fondo) < minimo; paso++) {
    tono = mezclar(hex, hacia, paso * 0.05);
  }
  return tono;
}

/**
 * El color que se ve en un campo que el centro no fijo: el de AKINE para principal y acento, y
 * para una zona, el que sale solo del color principal.
 */
export function colorPorDefecto(
  colores: ColoresDeTema,
  tema: TemaDeMarca,
  campo: CampoDeMarca,
): string {
  const referencia = REFERENCIA_DE_TEMA[tema];
  const principal = esColor(colores.principal) ? colores.principal : null;
  switch (campo) {
    case 'principal':
    case 'acento':
      return COLORES_DE_AKINE[tema][campo];
    case 'barraLateral':
    case 'cabecera':
      return principal === null
        ? referencia.superficie
        : mezclar(referencia.superficie, principal, TINTE[campo] / 100);
    case 'fondo':
      return referencia.fondo;
    case 'tarjeta':
    case 'pie':
      return referencia.superficie;
    case 'botonSecundario':
      return principal ?? referencia.bordeDeControl;
  }
}

/**
 * Los tokens de `design-system.css` que pisa la marca del centro en un tema.
 *
 * <p>El color principal es el de accion: botones, foco y, mezclado con la superficie, la seleccion
 * y el hover. El acento es el del texto de marca: enlaces y la pestana activa. Los colores con
 * significado (exito, aviso, peligro, estados del turno) no se tocan: quieren decir lo mismo en
 * todos los centros.
 */
export function tokensDeMarca(colores: ColoresDeTema, tema: TemaDeMarca): Record<string, string> {
  const tokens: Record<string, string> = {};
  const { principal, acento } = colores;
  if (esColor(principal)) {
    tokens['--color-accion-fondo'] = principal;
    tokens['--color-accion-fondo-hover'] =
      `color-mix(in srgb, ${principal} 85%, ${tema === 'claro' ? 'black' : 'white'})`;
    tokens['--color-accion-texto'] = textoSobre(principal);
    tokens['--color-foco'] = principal;
    tokens['--color-foco-sobre-marca'] = principal;
    tokens['--color-seleccion'] = `color-mix(in srgb, ${principal} 16%, var(--color-superficie))`;
    tokens['--color-hover'] = `color-mix(in srgb, ${principal} 7%, var(--color-superficie))`;
    // La barra lateral y la barra superior se tiñen: el tinte deja el texto de siempre legible.
    // Dentro de la barra lateral, hover y seleccion suben un escalon para despegarse del tinte.
    tokens['--color-marca-fondo'] =
      `color-mix(in srgb, ${principal} ${TINTE.barraLateral}%, var(--color-superficie))`;
    tokens['--color-marca-hover'] = `color-mix(in srgb, ${principal} 20%, var(--color-superficie))`;
    tokens['--color-marca-superficie-activa'] =
      `color-mix(in srgb, ${principal} 28%, var(--color-superficie))`;
    tokens['--color-cabecera-fondo'] =
      `color-mix(in srgb, ${principal} ${TINTE.cabecera}%, var(--color-superficie))`;
    // El boton secundario sigue siendo de contorno (la accion con relleno es una sola), pero el
    // contorno y el fondo son del centro.
    tokens['--color-secundario-borde'] = principal;
    tokens['--color-secundario-borde-hover'] = principal;
    tokens['--color-secundario-fondo'] =
      `color-mix(in srgb, ${principal} 8%, var(--color-superficie))`;
    tokens['--color-secundario-fondo-hover'] =
      `color-mix(in srgb, ${principal} 20%, var(--color-superficie))`;
  }
  if (esColor(acento)) {
    tokens['--color-acento'] = acento;
    tokens['--color-enlace'] = acento;
    tokens['--color-secundario-texto'] = acento;
  }

  // Zonas con color propio. El texto que va encima lo elige la aplicacion (blanco o casi negro),
  // asi que una barra de cualquier color se lee siempre.
  const { barraLateral, cabecera, fondo, tarjeta, pie, botonSecundario } = colores;
  // La tarjeta es la superficie de todo: los tintes de arriba se mezclan con ella sin tocar nada.
  // El texto NO se da vuelta (es el mismo token que el de la pagina): la pantalla avisa si no se lee.
  if (esColor(tarjeta)) {
    tokens['--color-superficie'] = tarjeta;
  }
  if (esColor(barraLateral)) {
    const texto = textoSobre(barraLateral);
    tokens['--color-marca-fondo'] = barraLateral;
    tokens['--color-marca-texto'] = texto;
    tokens['--color-marca-texto-suave'] = mezclar(texto, barraLateral, 0.2);
    tokens['--color-marca-hover'] = mezclar(barraLateral, texto, 0.1);
    tokens['--color-marca-superficie-activa'] = mezclar(barraLateral, texto, 0.2);
    tokens['--color-marca-activo-texto'] = texto;
    tokens['--color-foco-sobre-marca'] = texto;
  }
  if (esColor(cabecera)) {
    const texto = textoSobre(cabecera);
    tokens['--color-cabecera-fondo'] = cabecera;
    tokens['--color-cabecera-texto'] = texto;
    tokens['--color-cabecera-texto-suave'] = mezclar(texto, cabecera, 0.2);
    tokens['--color-cabecera-acento'] = texto;
    tokens['--color-cabecera-enlace'] = texto;
    tokens['--color-cabecera-hover'] = mezclar(cabecera, texto, 0.12);
  }
  if (esColor(pie)) {
    const texto = textoSobre(pie);
    tokens['--color-pie-fondo'] = pie;
    tokens['--color-pie-texto'] = texto;
    tokens['--color-pie-texto-suave'] = mezclar(texto, pie, 0.2);
  }
  if (esColor(fondo)) {
    tokens['--color-superficie-sutil'] = fondo;
  }
  if (esColor(botonSecundario)) {
    const superficie = REFERENCIA_DE_TEMA[tema].superficie;
    tokens['--color-secundario-borde'] = botonSecundario;
    tokens['--color-secundario-borde-hover'] = botonSecundario;
    tokens['--color-secundario-texto'] = tonoConContraste(botonSecundario, superficie, 4.5);
    tokens['--color-secundario-fondo'] =
      `color-mix(in srgb, ${botonSecundario} 8%, var(--color-superficie))`;
    tokens['--color-secundario-fondo-hover'] =
      `color-mix(in srgb, ${botonSecundario} 20%, var(--color-superficie))`;
  }
  return tokens;
}

/** Una paleta lista para usar: punto de partida, no un limite. */
export interface PaletaDeMarca {
  readonly nombre: string;
  readonly claro: ColoresDeTema;
  readonly oscuro: ColoresDeTema;
}

/**
 * Paletas sugeridas. Cada color principal llega a 3:1 contra la superficie de su tema y cada
 * acento a 4,5:1 (lo verifica `color-de-marca.spec.ts` contra los tokens de referencia).
 * "Azul AKINE" no fija nada: es volver a los colores por defecto.
 */
export const PALETAS_DE_MARCA: readonly PaletaDeMarca[] = [
  {
    nombre: 'Azul AKINE',
    claro: { principal: null, acento: null },
    oscuro: { principal: null, acento: null },
  },
  {
    nombre: 'Verde agua',
    claro: { principal: '#0f766e', acento: '#115e59' },
    oscuro: { principal: '#2dd4bf', acento: '#5eead4' },
  },
  {
    nombre: 'Esmeralda',
    claro: { principal: '#047857', acento: '#065f46' },
    oscuro: { principal: '#34d399', acento: '#6ee7b7' },
  },
  {
    nombre: 'Petróleo',
    claro: { principal: '#0e7490', acento: '#155e75' },
    oscuro: { principal: '#22d3ee', acento: '#67e8f9' },
  },
  {
    nombre: 'Índigo',
    claro: { principal: '#4338ca', acento: '#3730a3' },
    oscuro: { principal: '#818cf8', acento: '#a5b4fc' },
  },
  {
    nombre: 'Violeta',
    claro: { principal: '#7c3aed', acento: '#6d28d9' },
    oscuro: { principal: '#a78bfa', acento: '#c4b5fd' },
  },
  {
    nombre: 'Rosa',
    claro: { principal: '#be185d', acento: '#9d174d' },
    oscuro: { principal: '#f472b6', acento: '#f9a8d4' },
  },
  {
    nombre: 'Bordó',
    claro: { principal: '#9f1239', acento: '#881337' },
    oscuro: { principal: '#fb7185', acento: '#fda4af' },
  },
  {
    nombre: 'Terracota',
    claro: { principal: '#c2410c', acento: '#9a3412' },
    oscuro: { principal: '#fb923c', acento: '#fdba74' },
  },
  {
    nombre: 'Azul marino',
    claro: { principal: '#1e3a8a', acento: '#172554' },
    oscuro: { principal: '#8fa8ff', acento: '#b9c8ff' },
  },
  {
    nombre: 'Cielo',
    claro: { principal: '#0369a1', acento: '#075985' },
    oscuro: { principal: '#38bdf8', acento: '#7dd3fc' },
  },
  {
    nombre: 'Púrpura',
    claro: { principal: '#7e22ce', acento: '#6b21a8' },
    oscuro: { principal: '#c084fc', acento: '#d8b4fe' },
  },
  {
    nombre: 'Fucsia',
    claro: { principal: '#a21caf', acento: '#86198f' },
    oscuro: { principal: '#e879f9', acento: '#f0abfc' },
  },
  {
    nombre: 'Oliva',
    claro: { principal: '#4d7c0f', acento: '#3f6212' },
    oscuro: { principal: '#a3e635', acento: '#bef264' },
  },
  {
    nombre: 'Café',
    claro: { principal: '#7c4a2d', acento: '#5c3520' },
    oscuro: { principal: '#e0a878', acento: '#f0c9a4' },
  },
  {
    nombre: 'Grafito',
    claro: { principal: '#334155', acento: '#1e293b' },
    oscuro: { principal: '#94a3b8', acento: '#cbd5e1' },
  },
];
