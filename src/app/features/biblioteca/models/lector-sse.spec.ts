import { leerEventosSse } from './lector-sse';

function stream(...trozos: string[]): ReadableStream<Uint8Array> {
  const codificador = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controlador) {
      for (const trozo of trozos) {
        controlador.enqueue(codificador.encode(trozo));
      }
      controlador.close();
    },
  });
}

async function leer(cuerpo: ReadableStream<Uint8Array>) {
  const eventos = [];
  for await (const e of leerEventosSse(cuerpo)) {
    eventos.push(e);
  }
  return eventos;
}

describe('leerEventosSse', () => {
  it('eventoPartidoEnDosTrozos', async () => {
    const eventos = await leer(stream('event: texto\ndata: {"te', 'xto":"Hola"}\n\n'));
    expect(eventos).toEqual([{ evento: 'texto', datos: '{"texto":"Hola"}' }]);
  });

  it('caracterUtf8PartidoEntreTrozos', async () => {
    const bytes = new TextEncoder().encode('event: texto\ndata: {"texto":"canción"}\n\n');
    const corte = bytes.indexOf(0xc3) + 1; // el "ó" son dos bytes: se parte entre ellos
    const cuerpo = new ReadableStream<Uint8Array>({
      start(controlador) {
        controlador.enqueue(bytes.slice(0, corte));
        controlador.enqueue(bytes.slice(corte));
        controlador.close();
      },
    });
    expect(await leer(cuerpo)).toEqual([{ evento: 'texto', datos: '{"texto":"canción"}' }]);
  });
});
