/**
 * Formato liviano del texto que redacta el agente (docs/diseno/AKINE-asistente-agente.md §8):
 * párrafos, listas con `- ` o `1. `, `**negrita**` y enlaces a rutas de la app, en
 * `[texto](/ruta)` o sueltos como `/pacientes/12`. Arma un árbol que dibuja la plantilla con
 * interpolación: nada pasa por `innerHTML`, así que el texto no puede inyectar marcado. Vive en la
 * funcionalidad y no en `shared/` porque sabe qué rutas son de la app.
 */

export type TramoDelAgente =
  | { readonly tipo: 'texto'; readonly texto: string }
  | { readonly tipo: 'negrita'; readonly texto: string }
  | {
      readonly tipo: 'enlace';
      readonly texto: string;
      readonly ruta: string;
      readonly query: Readonly<Record<string, string>> | null;
    };

export type BloqueDelAgente =
  | { readonly tipo: 'parrafo'; readonly tramos: readonly TramoDelAgente[] }
  | { readonly tipo: 'lista'; readonly items: readonly (readonly TramoDelAgente[])[] }
  | { readonly tipo: 'lista-ordenada'; readonly items: readonly (readonly TramoDelAgente[])[] };

/**
 * Primeras partes de ruta que se enlazan cuando aparecen sueltas en el texto. Un enlace en
 * `[texto](/ruta)` se acepta con cualquier ruta interna; suelto, sólo con éstas, para no tomar por
 * ruta algo como una fecha o "y/o".
 */
const SECCIONES_SUELTAS = new Set([
  'pacientes',
  'personas',
  'agenda',
  'recepcion',
  'caja',
  'cobros',
  'reportes',
  'clases',
  'servicios',
  'casos',
  'atencion',
  'presentaciones',
]);

const VINETA = /^\s*[-*•]\s+(.*)$/;
const NUMERADO = /^\s*\d{1,3}[.)]\s+(.*)$/;
const TITULO = /^\s*#{1,6}\s+(.*)$/;
/** `[texto](/ruta)`, `**negrita**` o una ruta suelta precedida de inicio, espacio o paréntesis. */
const EN_LINEA =
  /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+?)\*\*|(^|[\s(])(\/[a-z][\w-]*(?:\/[\w-]+)*(?:\?[\w=&%.-]*)?)/g;
const RUTA_DE_PACIENTE = /^\/(?:pacientes|personas)\/(\d+)(?:[/?#]|$)/;

export function parsearTextoDelAgente(texto: string): BloqueDelAgente[] {
  const bloques: BloqueDelAgente[] = [];
  let parrafo: string[] = [];
  let lista: { ordenada: boolean; items: string[] } | null = null;

  const cerrarParrafo = (): void => {
    if (parrafo.length > 0) {
      bloques.push({ tipo: 'parrafo', tramos: tramosEnLinea(parrafo.join('\n')) });
      parrafo = [];
    }
  };
  const cerrarLista = (): void => {
    if (lista) {
      const items = lista.items.map((item) => tramosEnLinea(item));
      bloques.push(lista.ordenada ? { tipo: 'lista-ordenada', items } : { tipo: 'lista', items });
      lista = null;
    }
  };

  for (const linea of texto.replace(/\r\n?/g, '\n').split('\n')) {
    if (linea.trim() === '') {
      cerrarParrafo();
      cerrarLista();
      continue;
    }
    const vineta = VINETA.exec(linea);
    const numerado = vineta ? null : NUMERADO.exec(linea);
    if (vineta || numerado) {
      const ordenada = numerado !== null;
      cerrarParrafo();
      if (lista && lista.ordenada !== ordenada) {
        cerrarLista();
      }
      lista ??= { ordenada, items: [] };
      lista.items.push(((vineta ?? numerado) as RegExpExecArray)[1]);
      continue;
    }
    cerrarLista();
    const titulo = TITULO.exec(linea);
    if (titulo) {
      // Un título del modelo se lee como un párrafo en negrita: la charla no tiene jerarquía propia.
      cerrarParrafo();
      bloques.push({ tipo: 'parrafo', tramos: [{ tipo: 'negrita', texto: titulo[1].trim() }] });
      continue;
    }
    parrafo.push(linea);
  }
  cerrarParrafo();
  cerrarLista();
  return bloques;
}

/** Ids de las personas que enlaza el texto (`/pacientes/12`, `/personas/12`). */
export function personasEnlazadas(bloques: readonly BloqueDelAgente[]): number[] {
  const ids: number[] = [];
  const mirar = (tramos: readonly TramoDelAgente[]): void => {
    for (const t of tramos) {
      const id = t.tipo === 'enlace' ? idDePersonaEnRuta(t.ruta) : null;
      if (id !== null && !ids.includes(id)) {
        ids.push(id);
      }
    }
  };
  for (const b of bloques) {
    if (b.tipo === 'parrafo') {
      mirar(b.tramos);
    } else {
      b.items.forEach(mirar);
    }
  }
  return ids;
}

/** El id de persona de una ruta de la ficha, o null. */
export function idDePersonaEnRuta(ruta: string): number | null {
  const m = RUTA_DE_PACIENTE.exec(ruta);
  const id = m ? Number(m[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function tramosEnLinea(texto: string): TramoDelAgente[] {
  const tramos: TramoDelAgente[] = [];
  const agregarTexto = (t: string): void => {
    if (t === '') {
      return;
    }
    const ultimo = tramos.at(-1);
    if (ultimo?.tipo === 'texto') {
      tramos[tramos.length - 1] = { tipo: 'texto', texto: ultimo.texto + t };
    } else {
      tramos.push({ tipo: 'texto', texto: t });
    }
  };
  let desde = 0;
  for (const m of texto.matchAll(EN_LINEA)) {
    const inicio = m.index;
    agregarTexto(texto.slice(desde, inicio));
    desde = inicio + m[0].length;
    const [, etiqueta, destino, negrita, previo, suelta] = m;
    if (etiqueta !== undefined) {
      const enlace = enlaceInterno(etiqueta, destino);
      if (enlace) {
        tramos.push(enlace);
      } else {
        // Un destino externo o raro no se enlaza: queda la etiqueta como texto.
        agregarTexto(etiqueta);
      }
    } else if (negrita !== undefined) {
      tramos.push({ tipo: 'negrita', texto: negrita });
    } else {
      agregarTexto(previo);
      const seccion = suelta.slice(1).split(/[/?]/)[0];
      const enlace = SECCIONES_SUELTAS.has(seccion) ? enlaceInterno(suelta, suelta) : null;
      if (enlace) {
        tramos.push(enlace);
      } else {
        agregarTexto(suelta);
      }
    }
  }
  agregarTexto(texto.slice(desde));
  return tramos;
}

/** Sólo rutas de la app: empiezan con una sola `/`. Nada de `//host`, `javascript:` ni URLs. */
function enlaceInterno(texto: string, destino: string): TramoDelAgente | null {
  if (!/^\/(?!\/)[\w\-/.%?=&]*$/.test(destino)) {
    return null;
  }
  const [ruta, consulta] = destino.split('?', 2);
  let query: Record<string, string> | null = null;
  if (consulta) {
    query = {};
    for (const [clave, valor] of new URLSearchParams(consulta)) {
      query[clave] = valor;
    }
  }
  return { tipo: 'enlace', texto, ruta, query };
}
