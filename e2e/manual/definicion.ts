import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Las capturas del manual se declaran como datos (`e2e/manual/capturas/*.json`), no como código:
 * así `scripts/verificar-manual.mjs` las cruza con las fichas sin compilar TypeScript.
 * Diseño: appKine-api/docs/diseno/AKINE-manual-de-usuario.md §5.7.
 */
export interface Marca {
  /** Selector de Playwright que tiene que dar exactamente un elemento. */
  readonly selector: string;
  /** El número del paso; sin número, la marca es una zona. */
  readonly numero?: number;
  readonly forma?: 'recuadro' | 'zona';
}

/**
 * Un paso para llegar al estado de la captura antes de marcar. `opcional`: si el elemento no está
 * (la caja ya estaba abierta, por ejemplo), se saltea en vez de fallar.
 */
export type Paso = { readonly selector: string; readonly opcional?: boolean } & (
  | { readonly accion: 'click' }
  | { readonly accion: 'escribir'; readonly texto: string }
  | { readonly accion: 'esperar' }
);

export interface CapturaDelManual {
  readonly ficha: string;
  readonly nombre: string;
  /** Ruta de la aplicación. `:organizationId` y `:consultorioId` se reemplazan con los del centro sembrado. */
  readonly ruta: string;
  readonly pasos?: readonly Paso[];
  /** Selector de la zona que se recorta. */
  readonly recorte: string;
  readonly marcas: readonly Marca[];
  /** Cómo llegar al estado, en palabras, cuando todavía no hay pasos automáticos. */
  readonly preparacion?: string;
  /** Motivo por el que no se genera todavía (necesita datos que la siembra no crea). */
  readonly omitir?: string;
}

const CARPETA = join(__dirname, 'capturas');

export function leerCapturas(): CapturaDelManual[] {
  return readdirSync(CARPETA)
    .filter((archivo) => archivo.endsWith('.json'))
    .sort()
    .flatMap(
      (archivo) => JSON.parse(readFileSync(join(CARPETA, archivo), 'utf8')) as CapturaDelManual[],
    );
}
