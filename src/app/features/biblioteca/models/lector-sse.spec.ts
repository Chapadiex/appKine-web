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
});
