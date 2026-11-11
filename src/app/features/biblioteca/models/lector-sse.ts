/** Un evento SSE ya separado: nombre y datos (varias lineas `data:` unidas por un salto). */
export interface EventoSse {
  readonly evento: string;
  readonly datos: string;
}

/** Fin de linea SSE: CRLF, LF o CR. */
const FIN_DE_LINEA = /\r\n|\n|\r/;
/** Igual, pero un CR al final del buffer espera: puede ser la mitad de un CRLF. */
const FIN_DE_LINEA_COMPLETO = /\r\n|\n|\r(?!$)/;

/**
 * Lee un stream `text/event-stream` y entrega un evento por bloque separado por linea en blanco.
 *
 * <p>Decodifica UTF-8 en trozos (un caracter multibyte partido entre dos trozos no se rompe),
 * acepta los tres fines de linea, y un espacio opcional despues de los dos puntos (Spring
 * `SseEmitter` no lo manda). Las lineas que empiezan con `:` son comentarios (latidos) y se
 * ignoran. Un bloque sin `data:` no genera evento.
 */
export async function* leerEventosSse(
  cuerpo: ReadableStream<Uint8Array>,
): AsyncIterable<EventoSse> {
  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder('utf-8');
  let pendiente = '';
  let evento = '';
  let datos: string[] = [];

  const procesarLinea = (linea: string): EventoSse | null => {
    if (linea === '') {
      const listo =
        datos.length > 0 ? { evento: evento || 'message', datos: datos.join('\n') } : null;
      evento = '';
      datos = [];
      return listo;
    }
    if (linea.startsWith(':')) {
      return null;
    }
    const corte = linea.indexOf(':');
    const campo = corte < 0 ? linea : linea.slice(0, corte);
    let valor = corte < 0 ? '' : linea.slice(corte + 1);
    if (valor.startsWith(' ')) {
      valor = valor.slice(1);
    }
    if (campo === 'event') {
      evento = valor;
    } else if (campo === 'data') {
      datos.push(valor);
    }
    return null;
  };

  try {
    for (;;) {
      const { done, value } = await lector.read();
      pendiente += done ? decodificador.decode() : decodificador.decode(value, { stream: true });
      const terminador = done ? FIN_DE_LINEA : FIN_DE_LINEA_COMPLETO;
      for (;;) {
        const hallado = terminador.exec(pendiente);
        if (!hallado) {
          break;
        }
        const linea = pendiente.slice(0, hallado.index);
        pendiente = pendiente.slice(hallado.index + hallado[0].length);
        const listo = procesarLinea(linea);
        if (listo) {
          yield listo;
        }
      }
      if (done) {
        const listo = procesarLinea(pendiente) ?? procesarLinea('');
        if (listo) {
          yield listo;
        }
        return;
      }
    }
  } finally {
    await lector.cancel().catch(() => undefined);
  }
}
