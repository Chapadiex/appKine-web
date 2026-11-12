/**
 * Aritmetica de color de la marca del centro (colores institucionales por organizacion).
 *
 * <p>Todo trabaja con `#rrggbb`. El contraste es el de WCAG 2.1: sirve para elegir el texto que
 * va sobre el color del centro y para avisar cuando un color no se va a leer. Avisar, no impedir:
 * el centro elige libre.
 */

export type TemaDeMarca = 'claro' | 'oscuro';

/** Los dos colores que un centro elige por tema. `null` es "el de AKINE". */
export interface ColoresDeTema {
  readonly principal: string | null;
  readonly acento: string | null;
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Superficie de tarjeta y texto de cada tema, para medir contraste. Son los mismos valores que
 * `--ref-*` de `design-system.css`: un cambio alla va tambien aca.
 */
export const REFERENCIA_DE_TEMA: Readonly<
  Record<TemaDeMarca, { readonly superficie: string; readonly texto: string }>
> = {
  claro: { superficie: '#ffffff', texto: '#182230' },
  oscuro: { superficie: '#1d2a36', texto: '#f1f5f9' },
};

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
    tokens['--color-marca-fondo'] = `color-mix(in srgb, ${principal} 12%, var(--color-superficie))`;
    tokens['--color-marca-hover'] = `color-mix(in srgb, ${principal} 20%, var(--color-superficie))`;
    tokens['--color-marca-superficie-activa'] =
      `color-mix(in srgb, ${principal} 28%, var(--color-superficie))`;
    tokens['--color-cabecera-fondo'] =
      `color-mix(in srgb, ${principal} 7%, var(--color-superficie))`;
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
    nombre: 'Grafito',
    claro: { principal: '#334155', acento: '#1e293b' },
    oscuro: { principal: '#94a3b8', acento: '#cbd5e1' },
  },
];
