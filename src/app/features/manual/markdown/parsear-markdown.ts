/**
 * El subconjunto de Markdown de las fichas del manual (appKine-api/src/main/resources/manual y
 * docs/diseno/AKINE-manual-de-usuario.md §5.1 y §5.7), parseado a datos que una plantilla Angular
 * dibuja con `@for`/`@switch`. **Nunca a HTML:** lo que no se reconoce queda como texto literal, así
 * que un `<img onerror>` metido en una ficha se ve escrito y no se ejecuta.
 */

export type Inline =
  | { readonly tipo: 'texto'; readonly texto: string }
  | { readonly tipo: 'negrita'; readonly texto: string }
  | { readonly tipo: 'icono'; readonly nombre: string }
  | { readonly tipo: 'enlace'; readonly ruta: string; readonly texto: string }
  | { readonly tipo: 'marca'; readonly numero: number };

export type Bloque =
  | { readonly tipo: 'titulo'; readonly nivel: 2 | 3; readonly contenido: readonly Inline[]; readonly texto: string }
  | { readonly tipo: 'parrafo'; readonly contenido: readonly Inline[] }
  | { readonly tipo: 'lista-ordenada'; readonly items: readonly (readonly Inline[])[] }
  | { readonly tipo: 'lista'; readonly items: readonly (readonly Inline[])[] }
  | { readonly tipo: 'aviso'; readonly variante: 'importante' | 'consejo'; readonly contenido: readonly Inline[] }
  | { readonly tipo: 'captura'; readonly ficha: string; readonly nombre: string; readonly alt: string };

const CAPTURA = /^!\[([^\]]*)\]\(captura:([a-z0-9-]+)\/([a-z0-9-]+)\)\s*$/;
const AVISO = /^\[!(importante|consejo)\]\s*$/i;
const ORDENADA = /^\d+\.\s+(.*)$/;
const SIMPLE = /^[-*]\s+(.*)$/;
/** Negrita, ícono, enlace o número de marca (① a ⑳). */
const INLINE = /\*\*(.+?)\*\*|:icono\[([a-z-]+)\]:|\[([^\]]+)\]\(([^)\s]+)\)|([①-⑳])/g;
/** Sólo rutas internas de la aplicación: `/algo`, nunca `//host` ni un esquema. */
const RUTA_INTERNA = /^\/(?!\/)[^\s:]*$/;

export function parsearMarkdown(markdown: string): Bloque[] {
  const lineas = (markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const bloques: Bloque[] = [];
  let parrafo: string[] = [];
  // `as` en el inicializador: sin él, TypeScript estrecha a `null` y no ve las asignaciones de los
  // cierres de abajo.
  let lista = null as { tipo: 'lista' | 'lista-ordenada'; items: Inline[][] } | null;
  let aviso = null as { variante: 'importante' | 'consejo'; lineas: string[] } | null;

  const cerrarParrafo = (): void => {
    if (parrafo.length > 0) {
      bloques.push({ tipo: 'parrafo', contenido: parsearInline(parrafo.join(' ')) });
      parrafo = [];
    }
  };
  const cerrarLista = (): void => {
    if (lista) {
      bloques.push({ tipo: lista.tipo, items: lista.items });
      lista = null;
    }
  };
  const cerrarAviso = (): void => {
    if (aviso) {
      bloques.push({ tipo: 'aviso', variante: aviso.variante, contenido: parsearInline(aviso.lineas.join(' ')) });
      aviso = null;
    }
  };
  const cerrarTodo = (): void => {
    cerrarParrafo();
    cerrarLista();
    cerrarAviso();
  };

  for (const cruda of lineas) {
    const linea = cruda.trim();
    if (linea.startsWith('>')) {
      const dentro = linea.replace(/^>\s?/, '');
      const encabezado = AVISO.exec(dentro);
      if (encabezado) {
        cerrarTodo();
        aviso = { variante: encabezado[1].toLowerCase() as 'importante' | 'consejo', lineas: [] };
      } else if (aviso) {
        if (dentro) aviso.lineas.push(dentro);
      } else {
        cerrarParrafo();
        cerrarLista();
        parrafo.push(dentro);
      }
      continue;
    }
    cerrarAviso();
    if (!linea) {
      cerrarParrafo();
      cerrarLista();
      continue;
    }
    if (linea.startsWith('### ') || linea.startsWith('## ')) {
      cerrarTodo();
      const nivel = linea.startsWith('### ') ? 3 : 2;
      const texto = linea.slice(nivel + 1).trim();
      bloques.push({ tipo: 'titulo', nivel, contenido: parsearInline(texto), texto });
      continue;
    }
    const captura = CAPTURA.exec(linea);
    if (captura) {
      cerrarTodo();
      bloques.push({ tipo: 'captura', alt: captura[1], ficha: captura[2], nombre: captura[3] });
      continue;
    }
    const ordenada = ORDENADA.exec(linea);
    const simple = ordenada ? null : SIMPLE.exec(linea);
    if (ordenada || simple) {
      cerrarParrafo();
      const tipo = ordenada ? 'lista-ordenada' : 'lista';
      if (lista?.tipo !== tipo) {
        cerrarLista();
        lista = { tipo, items: [] };
      }
      lista!.items.push(parsearInline((ordenada ?? simple)![1]));
      continue;
    }
    if (lista && cruda.startsWith('  ')) {
      // Continuación de un ítem largo, partido en varias líneas.
      const ultimo = lista.items[lista.items.length - 1];
      lista.items[lista.items.length - 1] = [...ultimo, { tipo: 'texto', texto: ' ' }, ...parsearInline(linea)];
      continue;
    }
    cerrarLista();
    parrafo.push(linea);
  }
  cerrarTodo();
  return bloques;
}

export function parsearInline(texto: string): Inline[] {
  const resultado: Inline[] = [];
  let desde = 0;
  for (const m of texto.matchAll(INLINE)) {
    const inicio = m.index ?? 0;
    if (inicio > desde) resultado.push({ tipo: 'texto', texto: texto.slice(desde, inicio) });
    if (m[1] !== undefined) {
      resultado.push({ tipo: 'negrita', texto: m[1] });
    } else if (m[2] !== undefined) {
      resultado.push({ tipo: 'icono', nombre: m[2] });
    } else if (m[3] !== undefined) {
      resultado.push(
        RUTA_INTERNA.test(m[4]) ? { tipo: 'enlace', ruta: m[4], texto: m[3] } : { tipo: 'texto', texto: m[0] },
      );
    } else if (m[5] !== undefined) {
      resultado.push({ tipo: 'marca', numero: m[5].charCodeAt(0) - 0x2460 + 1 });
    }
    desde = inicio + m[0].length;
  }
  if (desde < texto.length) resultado.push({ tipo: 'texto', texto: texto.slice(desde) });
  return resultado;
}
