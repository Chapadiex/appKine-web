/**
 * Íconos propios del manual. Viven acá y no en `TRAZOS` de `app-icono` porque el manual se carga
 * diferido y el bundle inicial no tiene margen. Mismo lenguaje: trazos de 24 px, sólo contorno.
 */
export const ICONOS_DEL_MANUAL = {
  'para-que-sirve':
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  tareas: 'M9 6h11M9 12h11M9 18h11M4 5.5l1 1 2-2M4 11.5l1 1 2-2M4 17.5l1 1 2-2',
  estados: 'M4 7h4M4 12h4M4 17h4M12 5.5h8v3h-8zM12 10.5h8v3h-8zM12 15.5h8v3h-8z',
  problemas: 'M12 3.5 21 19.5H3zM12 10v4M12 16.8h.01',
  relacionadas:
    'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  importante: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5v6M12 16.5h.01',
  consejo:
    'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  manual: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21a2 2 0 0 1 2-2h13v2H6M8 7h7M8 10.5h5',
} as const satisfies Record<string, string>;

export type IconoDelManual = keyof typeof ICONOS_DEL_MANUAL;

/** El trazo de un ícono propio del manual, o `undefined` si no es uno de ellos. */
export function trazoDelManual(nombre: string): string | undefined {
  return Object.hasOwn(ICONOS_DEL_MANUAL, nombre)
    ? ICONOS_DEL_MANUAL[nombre as IconoDelManual]
    : undefined;
}

/** El ícono de cada sección fija de una ficha, por su título normalizado. */
export const ICONO_DE_SECCION: Readonly<Record<string, IconoDelManual>> = {
  'para que sirve': 'para-que-sirve',
  tareas: 'tareas',
  terminos: 'tareas',
  'que significa cada estado': 'estados',
  'problemas comunes': 'problemas',
};

/** Minúsculas y sin tildes: la clave de `ICONO_DE_SECCION`. */
export function normalizarTitulo(titulo: string): string {
  return titulo
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
